// Read-only view of a merged context node for the chat panel's inherited-
// context block: title/summary + each source's frozen (cutoff) snapshot,
// grouped and ordered per source (see components/thread/ThreadPanel.vue).

export default defineEventHandler(async (event) => {
  const { admin, teamId } = await requireCallerTeam(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const { data: mergedNode } = await admin
    .from('merged_context_nodes')
    .select('conversation_id, conversations(team_id)')
    .eq('id', id)
    .single()
  if (!mergedNode) throw createError({ statusCode: 404, statusMessage: 'merged node not found' })
  const convoTeam = Array.isArray(mergedNode.conversations) ? mergedNode.conversations[0] : mergedNode.conversations
  if ((convoTeam as { team_id?: string } | null)?.team_id !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'not on your team' })
  }

  return loadMergedContext(admin, id)
})
