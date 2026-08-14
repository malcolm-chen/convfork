// Set a "conversation node" (segment/branch card, composables/useSegments.ts)
// title — either a human's explicit rename or a freshly-generated LLM summary
// (composables/useNodeSummaries.ts). Writes go through the admin client and
// arrive back over the existing nodes UPDATE realtime subscription
// (composables/useRealtime.ts), so both kinds of title are live for every
// team member, not just the browser that set them.
//
// Only the head node of a segment carries a title — see useSegments.ts's
// isStart — but that's a client-side structural fact about the whole tree, so
// it isn't (and doesn't need to be) re-verified here; worst case a non-head
// node gets a title column set that nothing currently reads.

interface Body {
  nodeId: string
  title: string
  manual: boolean
  hash?: string | null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<Body>(event)
  const title = body?.title?.trim()
  if (!body?.nodeId || !title) throw createError({ statusCode: 400, statusMessage: 'nodeId and title required' })
  if (title.length > 80) throw createError({ statusCode: 400, statusMessage: 'title too long (max 80 chars)' })

  const admin = useSupabaseAdmin()

  const { data: node } = await admin
    .from('nodes')
    .select('id, author_id, visibility, title_manual, conversations(team_id)')
    .eq('id', body.nodeId)
    .single()
  if (!node) throw createError({ statusCode: 404, statusMessage: 'node not found' })

  const { data: profile } = await admin.from('users').select('team_id').eq('id', user.id).single()
  const convoTeam = Array.isArray(node.conversations) ? node.conversations[0] : node.conversations
  if (!profile || profile.team_id !== (convoTeam as { team_id?: string } | null)?.team_id) {
    throw createError({ statusCode: 403, statusMessage: 'not a member of this team' })
  }
  // Same visibility rule as nodes_select RLS: you can act on your own node
  // regardless of visibility, or any node your team can already see.
  if (node.author_id !== user.id && node.visibility !== 'shared') {
    throw createError({ statusCode: 403, statusMessage: 'cannot rename a private node you do not own' })
  }

  // A human rename always wins. An auto-summary (manual: false) must never
  // clobber one that already happened — silently no-op instead of erroring,
  // since the caller (a background watcher) has no UI to surface this to.
  if (!body.manual && node.title_manual) return { ok: true, skipped: true }

  const { error } = await admin
    .from('nodes')
    .update({
      title,
      title_manual: body.manual,
      title_hash: body.manual ? null : (body.hash ?? null),
    })
    .eq('id', body.nodeId)
  if (error) throw createError({ statusCode: 500, statusMessage: `rename node: ${error.message}` })

  return { ok: true }
})
