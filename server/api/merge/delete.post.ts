// Delete a merged context node — only its author may. Any conversation node
// (segment) forked from it, and anything forked from THOSE in turn, only
// exists because of this merge, so it's erased along with it (the client
// warns about this before calling in, see MergedNodeCard.vue / the
// conversation page's onDeleteMerge).

interface Body {
  mergedNodeId: string
}

export default defineEventHandler(async (event) => {
  const { user, admin, teamId } = await requireCallerTeam(event)
  const body = await readBody<Body>(event)
  if (!body?.mergedNodeId) throw createError({ statusCode: 400, statusMessage: 'mergedNodeId required' })

  const { data: mergedNode } = await admin
    .from('merged_context_nodes')
    .select('id, conversation_id, created_by, conversations(team_id)')
    .eq('id', body.mergedNodeId)
    .single()
  if (!mergedNode) throw createError({ statusCode: 404, statusMessage: 'merged node not found' })
  const convoTeam = Array.isArray(mergedNode.conversations) ? mergedNode.conversations[0] : mergedNode.conversations
  if ((convoTeam as { team_id?: string } | null)?.team_id !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'not on your team' })
  }
  if (mergedNode.created_by !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'only the author of a merge can delete it' })
  }

  const { data: forkedRoots, error: rootsErr } = await admin
    .from('nodes')
    .select('id')
    .eq('parent_merged_node_id', body.mergedNodeId)
  if (rootsErr) throw createError({ statusCode: 500, statusMessage: `list forks: ${rootsErr.message}` })

  const rootIds = (forkedRoots ?? []).map((n) => n.id)
  let erasedNodeIds: string[] = []
  if (rootIds.length) {
    erasedNodeIds = await collectDescendantIds(admin, mergedNode.conversation_id, rootIds)
    await purgeNodesByIds(admin, erasedNodeIds)
  }

  // merged_context_sources cascades via its own FK (on delete cascade).
  const { error: delErr } = await admin.from('merged_context_nodes').delete().eq('id', body.mergedNodeId)
  if (delErr) throw createError({ statusCode: 500, statusMessage: `delete merged node: ${delErr.message}` })

  // erasedNodeIds travels back so the client can broadcast them — a plain
  // nodes DELETE isn't reliably delivered to teammates over postgres_changes
  // (RLS-over-realtime for DELETE is unreliable in practice, same root cause
  // as the retract/reveal broadcasts in useRealtime.ts), so this cascade
  // purge needs the same explicit-broadcast treatment.
  return { ok: true, erasedNodeIds }
})
