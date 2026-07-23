// LLM proxy + SSE (design doc §2.2/§3) with the plan's corrections:
//  - parent visibility/ownership verified server-side (never trust the client)
//  - user node persisted BEFORE streaming (the turn is never lost)
//  - assistant node persisted in a `finally`, so a client disconnect mid-stream
//    can't drop the answer (§8.3)
//  - cross-member forks recorded in team_interaction_logs (§5.3)

interface ChatBody {
  conversationId: string
  parentNodeId: string | null
  userText: string
  userNodeId?: string
  assistantNodeId?: string
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<ChatBody>(event)

  if (!body?.conversationId || !body?.userText?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'conversationId and userText required' })
  }

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
    // a new child marks a fork point if it forks another author's branch or
    // creates a divergence (parent already had children)
    const { count } = await admin
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parent.id)
    isForkPoint = isForkFromOther || (count ?? 0) > 0
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
    },
    { onConflict: 'id' },
  )
  if (userErr) throw createError({ statusCode: 500, statusMessage: `persist user node: ${userErr.message}` })

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
      let errMsg: string | null = null
      const safeEnqueue = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* client disconnected — keep accumulating so we still persist */
        }
      }

      try {
        for await (const token of callLLM(messages)) {
          full += token
          safeEnqueue({ t: token })
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
              visibility,
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
