// LLM proxy + SSE (design doc §2.2/§3) with the plan's corrections:
//  - parent visibility/ownership verified server-side (never trust the client)
//  - user node persisted BEFORE streaming (the turn is never lost)
//  - assistant node persisted in a `finally`, so a client disconnect mid-stream
//    can't drop the answer (§8.3)
//  - cross-member forks recorded in team_interaction_logs (§5.3)

import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '#shared/models'

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
  // Set when this send replaces a previously-sent user message ("Edit" on a
  // message bubble, ThreadPanel.vue). Nodes are immutable (see
  // enforce_node_immutability in the migrations), so an edit can never UPDATE
  // the old row — instead we purge the edited node + the AI reply it produced
  // (and anything built on top, though the client only offers this on an
  // unbranched tip) and insert a fresh user node under the same parent below.
  editNodeId?: string
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

  // conversation + caller team check
  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id')
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

  // Both remaining study conditions start nodes private (selective_sharing:
  // the author opts in later; individual_llm: sharing is disabled entirely,
  // enforced in the DB by enforce_team_sharing_condition()).
  const visibility = 'private'

  // Editing a past message: verify ownership, verify it's still an unbranched
  // tip (no sibling forks, and its reply has no follow-ups of its own — the
  // client hides the Edit affordance in every other case, but never trust
  // that alone), then purge the old branch. The rebuilt turn below is then
  // inserted as an ordinary continuation of the edited node's own parent.
  let carriedTitle: { title: string | null; title_manual: boolean; title_hash: string | null } | null = null
  if (body.editNodeId) {
    const { data: target } = await admin
      .from('nodes')
      .select('id, conversation_id, author_id, role, parent_id, parent_merged_node_id, is_fork_point, title, title_manual, title_hash')
      .eq('id', body.editNodeId)
      .single()
    if (!target || target.conversation_id !== body.conversationId || target.role !== 'user' || target.author_id !== user.id) {
      throw createError({ statusCode: 403, statusMessage: 'cannot edit this message' })
    }
    const { data: children } = await admin.from('nodes').select('id').eq('parent_id', target.id)
    if ((children?.length ?? 0) > 1) {
      throw createError({ statusCode: 409, statusMessage: 'this message has multiple branches; cannot edit' })
    }
    const onlyChildId = children?.[0]?.id
    if (onlyChildId) {
      const { count: grandchildCount } = await admin
        .from('nodes')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', onlyChildId)
      if ((grandchildCount ?? 0) > 0) {
        throw createError({ statusCode: 409, statusMessage: 'this reply has follow-up messages; cannot edit' })
      }
    }

    // If the edited message was itself this branch's segment head (see
    // useSegments.ts's isStart), carry its canvas title over to the
    // replacement node — otherwise editing a branch's opening message would
    // silently wipe out its name.
    let isHead = !target.parent_id || target.is_fork_point
    if (!isHead && target.parent_id) {
      const { data: siblings } = await admin.from('nodes').select('id, is_fork_point').eq('parent_id', target.parent_id)
      isHead = (siblings ?? []).filter((s) => !s.is_fork_point).length > 1
    }
    if (isHead) {
      carriedTitle = { title: target.title, title_manual: target.title_manual, title_hash: target.title_hash }
    }

    const idsToDelete = await collectDescendantIds(admin, body.conversationId, [target.id])
    await purgeNodesByIds(admin, idsToDelete)

    // Continue from where the edited message was — a root edit re-attaches
    // to the merged node it was forked from, if any, unless the client
    // already specified one explicitly.
    body.parentNodeId = target.parent_id
    if (!target.parent_id && target.parent_merged_node_id && !body.mergedNodeId) {
      body.mergedNodeId = target.parent_merged_node_id
    }
  }

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
      ...(carriedTitle ?? {}),
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
        // If the client edited the very message this was replying to before
        // generation finished, useLLMStream aborts the client's connection
        // and — since editing purges the old user node — this upsert's
        // parent_id now points at a row that no longer exists. That's not a
        // bug to surface, just this turn losing the race to the edit: drop it
        // instead of throwing out of a ReadableStream's finally (which would
        // otherwise become an unhandled rejection).
        const { error: assistantErr } = await admin.from('nodes').upsert(
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

        // cross-member fork → team_interaction_logs (de-noised RQ2 source) —
        // only meaningful if the reply above actually landed somewhere.
        if (!assistantErr && isForkFromOther && parentAuthor) {
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
