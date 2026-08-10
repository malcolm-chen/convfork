// LLM proxy + SSE (design doc §2.2/§3) with the plan's corrections:
//  - parent visibility/ownership verified server-side (never trust the client)
//  - user node persisted BEFORE streaming (the turn is never lost)
//  - assistant node persisted in a `finally`, so a client disconnect mid-stream
//    can't drop the answer (§8.3)
//  - cross-member forks recorded in team_interaction_logs (§5.3)

import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '../../shared/models'

interface AttachmentRef {
  key: string
  filename: string
  contentType: string
  size: number
  kind: 'image' | 'pdf'
}

interface ChatBody {
  conversationId: string
  parentNodeId: string | null
  userText: string
  userNodeId?: string
  assistantNodeId?: string
  model?: string
  thinking?: string
  attachments?: AttachmentRef[]
  isFork?: boolean
  // Only meaningful when parentNodeId is null: this turn starts a brand new
  // segment (conversation node) forked from a merged context node — see the
  // "Fork" action on a merged node card, components/tree/MergedNodeCard.vue.
  mergedNodeId?: string
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<ChatBody>(event)

  if (!body?.conversationId || !body?.userText?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'conversationId and userText required' })
  }
  const model = body.model && MODEL_OPTIONS.some((m) => m.id === body.model) ? body.model : DEFAULT_MODEL_ID
  const modelSupportsThinking = MODEL_OPTIONS.find((m) => m.id === model)?.supportsThinking
  const thinking = modelSupportsThinking ? body.thinking : undefined

  // Attachments were uploaded (and S3-key-prefixed) for this conversation by
  // /api/upload — reject anything that doesn't match, since the key is the
  // only thing standing between this insert and referencing someone else's file.
  const keyPrefix = `uploads/${body.conversationId}/`
  const attachments = (body.attachments ?? []).filter((a) => a.key.startsWith(keyPrefix))

  const admin = useSupabaseAdmin()

  // conversation + caller team check (+ study sharing condition)
  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id, teams(sharing_condition)')
    .eq('id', body.conversationId)
    .single()
  if (!convo) throw createError({ statusCode: 404, statusMessage: 'conversation not found' })

  const { data: profile } = await admin
    .from('users')
    .select('team_id')
    .eq('id', user.id)
    .single()
  if (!profile || profile.team_id !== convo.team_id) {
    throw createError({ statusCode: 403, statusMessage: 'not a member of this team' })
  }

  const teamRow = Array.isArray(convo.teams) ? convo.teams[0] : convo.teams
  const sharingCondition = (teamRow as { sharing_condition?: string } | null)?.sharing_condition
  // default → auto-public; selective_sharing → private until the author shares
  const visibility = sharingCondition === 'default' ? 'shared' : 'private'

  // parent validation + fork detection
  let isForkFromOther = false
  let parentAuthor: string | null = null
  let isForkPoint = false

  if (body.parentNodeId) {
    const { data: parent } = await admin
      .from('nodes')
      .select('id, conversation_id, author_id, visibility')
      .eq('id', body.parentNodeId)
      .single()
    if (!parent || parent.conversation_id !== body.conversationId) {
      throw createError({ statusCode: 400, statusMessage: 'invalid parent node' })
    }
    const ownParent = parent.author_id === user.id
    if (!ownParent && parent.visibility !== 'shared') {
      throw createError({ statusCode: 403, statusMessage: 'can only fork from a shared node' })
    }
    parentAuthor = parent.author_id
    isForkFromOther = !ownParent
    // A new child marks a fork point if: the client explicitly forked here
    // (so it always gets its own chat, even as the parent's first and only
    // child so far — sibling count alone can't tell "fork" from "continue"),
    // it forks another author's branch, or it creates a divergence (parent
    // already had children).
    const { count } = await admin
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parent.id)
    isForkPoint = body.isFork === true || isForkFromOther || (count ?? 0) > 0
  }

  // A merged-node fork starts a brand new root-level segment (parent_id
  // null already makes it a segment start — see useSegments.ts's isStart —
  // no is_fork_point needed) that carries a reference back to the merged
  // node it was forked from.
  let mergedNodeId: string | null = null
  if (!body.parentNodeId && body.mergedNodeId) {
    const { data: mergedNode } = await admin
      .from('merged_context_nodes')
      .select('id, conversation_id')
      .eq('id', body.mergedNodeId)
      .single()
    if (!mergedNode || mergedNode.conversation_id !== body.conversationId) {
      throw createError({ statusCode: 400, statusMessage: 'invalid merged node' })
    }
    mergedNodeId = mergedNode.id
  }

  // 1) persist the user node BEFORE streaming (idempotent upsert by id)
  const userNodeId = body.userNodeId || crypto.randomUUID()
  const { error: userErr } = await admin.from('nodes').upsert(
    {
      id: userNodeId,
      conversation_id: body.conversationId,
      parent_id: body.parentNodeId,
      author_id: user.id,
      role: 'user',
      content: body.userText,
      visibility,
      is_fork_point: isForkPoint,
      parent_merged_node_id: mergedNodeId,
    },
    { onConflict: 'id' },
  )
  if (userErr) throw createError({ statusCode: 500, statusMessage: `persist user node: ${userErr.message}` })

  if (attachments.length) {
    const { error: attErr } = await admin.from('attachments').insert(
      attachments.map((a) => ({
        node_id: userNodeId,
        filename: a.filename,
        content_type: a.contentType,
        size_bytes: a.size,
        s3_key: a.key,
        kind: a.kind,
      })),
    )
    if (attErr) throw createError({ statusCode: 500, statusMessage: `persist attachments: ${attErr.message}` })
  }

  // 2) build context
  const messages = await buildLineageMessages(admin, userNodeId)

  // 3) stream tokens to the initiator; persist assistant node in finally
  const assistantNodeId = body.assistantNodeId || crypto.randomUUID()
  setResponseHeaders(event, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = ''
      let reasoning = ''
      let errMsg: string | null = null
      const safeEnqueue = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* client disconnected — keep accumulating so we still persist */
        }
      }

      try {
        for await (const chunk of callLLM(messages, model, thinking)) {
          if (chunk.type === 'reasoning') {
            reasoning += chunk.text
            safeEnqueue({ r: chunk.text })
          } else {
            full += chunk.text
            safeEnqueue({ t: chunk.text })
          }
        }
      } catch (e) {
        errMsg = e instanceof Error ? e.message : 'generation failed'
      } finally {
        // Persist regardless of stream delivery. On error with no content,
        // store an error assistant node so no user turn is left dangling.
        const content = full || `⚠️ generation failed: ${errMsg ?? 'unknown error'}`
        await admin
          .from('nodes')
          .upsert(
            {
              id: assistantNodeId,
              conversation_id: body.conversationId,
              parent_id: userNodeId,
              author_id: user.id,
              role: 'assistant',
              content,
              reasoning: reasoning || null,
              visibility,
              model,
            },
            { onConflict: 'id' },
          )
          .then(() => undefined)

        // cross-member fork → team_interaction_logs (de-noised RQ2 source)
        if (isForkFromOther && parentAuthor) {
          await admin
            .from('team_interaction_logs')
            .insert({
              team_id: convo.team_id,
              conversation_id: body.conversationId,
              actor_user_id: user.id,
              target_user_id: parentAuthor,
              interaction_type: 'fork_from_other',
              source_node_id: body.parentNodeId,
              result_node_id: assistantNodeId,
            })
            .then(() => undefined)
        }

        safeEnqueue(
          errMsg
            ? { error: errMsg, nodeId: assistantNodeId, userNodeId }
            : { done: true, nodeId: assistantNodeId, userNodeId },
        )
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
  })

  return stream
})
