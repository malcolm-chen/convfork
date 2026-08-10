// Clears this project's concept vocabulary and every segment's assignment
// (e.g. after tuning the tagging prompt) so the canvas re-tags from scratch
// on next view, instead of being stuck with concepts minted under a stale
// prompt (see server/utils/concepts.ts and composables/useConcepts.ts).

interface Body {
  conversationId: string
}

export default defineEventHandler(async (event) => {
  const { admin, teamId } = await requireCallerTeam(event)
  const body = await readBody<Body>(event)
  if (!body?.conversationId) throw createError({ statusCode: 400, statusMessage: 'conversationId required' })

  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id')
    .eq('id', body.conversationId)
    .single()
  if (!convo || convo.team_id !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'conversation is not on your team' })
  }

  // segment_concept_state isn't scoped by conversation_id directly (keyed by
  // segment_head_node_id -> nodes.id) — clear it via this conversation's own nodes.
  const { data: nodeRows } = await admin.from('nodes').select('id').eq('conversation_id', body.conversationId)
  const nodeIds = (nodeRows ?? []).map((n) => n.id)
  if (nodeIds.length) {
    await admin.from('segment_concept_state').delete().in('segment_head_node_id', nodeIds)
  }
  // Deleting concepts cascades to segment_concepts (on delete cascade FK).
  await admin.from('concepts').delete().eq('conversation_id', body.conversationId)

  return { ok: true }
})
