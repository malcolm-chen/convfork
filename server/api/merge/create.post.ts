// Create a merged context node over 2+ conversation nodes (segments) that
// all live in the same project's canvas. Each source is frozen at the tip
// node the client observed at create time — reconstruction later walks
// parent_id from that tip back to the segment's head (see
// server/utils/mergedContext.ts's fetchSegmentSnapshot) — so continuing that
// branch afterward never silently changes what was merged.

interface Body {
  conversationId: string
  title: string
  summary: string
  segments: { headNodeId: string; tipNodeId: string }[]
}

export default defineEventHandler(async (event) => {
  const { user, admin, teamId } = await requireCallerTeam(event)
  const body = await readBody<Body>(event)
  const title = body?.title?.trim()
  const summary = (body?.summary ?? '').trim()
  const segments = body?.segments ?? []

  if (!body?.conversationId) throw createError({ statusCode: 400, statusMessage: 'conversationId required' })
  if (!title) throw createError({ statusCode: 400, statusMessage: 'title required' })
  if (segments.length < 2) throw createError({ statusCode: 400, statusMessage: 'select at least 2 conversation nodes' })

  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id')
    .eq('id', body.conversationId)
    .single()
  if (!convo || convo.team_id !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'conversation is not on your team' })
  }

  // Validate each segment belongs to this conversation, resolve its author,
  // and confirm it actually has shared content to merge.
  const resolvedSegments = await Promise.all(
    segments.map(async (s) => {
      const { data: headNode } = await admin
        .from('nodes')
        .select('id, conversation_id, author_id, visibility')
        .eq('id', s.headNodeId)
        .single()
      if (!headNode || headNode.conversation_id !== body.conversationId) {
        throw createError({ statusCode: 400, statusMessage: 'invalid conversation node' })
      }
      // segment_head_node_id is later resolved by every team member's own
      // client (see ReasoningTree.vue), not just the merge's creator — a
      // private head (reachable via selective per-turn sharing) is loaded
      // by nobody but its author, so teammates could never find it. The
      // client is expected to send the segment's first *shared* node instead
      // (composables/useSegments.ts's firstSharedNodeId); reject anything
      // else rather than silently persisting a reference only its author can
      // ever resolve.
      if (headNode.visibility !== 'shared') {
        throw createError({ statusCode: 400, statusMessage: 'segment head must be shared' })
      }
      const snapshot = await fetchSegmentSnapshot(admin, s.headNodeId, s.tipNodeId)
      if (!snapshot.length) {
        throw createError({ statusCode: 400, statusMessage: 'a selected conversation node has no shared content' })
      }
      return { headNodeId: s.headNodeId, tipNodeId: s.tipNodeId, authorId: headNode.author_id as string }
    }),
  )

  const { data: mergedNode, error: mnErr } = await admin
    .from('merged_context_nodes')
    .insert({ conversation_id: body.conversationId, title, summary, created_by: user.id })
    .select('id, title, summary, created_at')
    .single()
  if (mnErr || !mergedNode) {
    throw createError({ statusCode: 500, statusMessage: `create merged node: ${mnErr?.message}` })
  }

  const sourceRows = resolvedSegments.map((s) => ({
    merged_node_id: mergedNode.id,
    segment_head_node_id: s.headNodeId,
    author_id: s.authorId,
    included_through_turn_id: s.tipNodeId,
  }))
  const { error: srcErr } = await admin.from('merged_context_sources').insert(sourceRows)
  if (srcErr) {
    // best-effort cleanup so a partial merge doesn't linger
    await admin.from('merged_context_nodes').delete().eq('id', mergedNode.id)
    throw createError({ statusCode: 500, statusMessage: `create merged sources: ${srcErr.message}` })
  }

  return {
    id: mergedNode.id,
    title: mergedNode.title,
    summary: mergedNode.summary,
    createdAt: mergedNode.created_at,
  }
})
