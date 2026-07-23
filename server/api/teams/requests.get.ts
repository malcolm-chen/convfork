// Pending join requests for the caller's own team, with requester names — shown
// to existing members so they can admit newcomers. Requesters aren't in the team
// yet, so their profiles aren't visible under RLS; we resolve names server-side.

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const admin = useSupabaseAdmin()

  const { data: me } = await admin.from('users').select('team_id').eq('id', user.id).single()
  if (!me?.team_id) return { requests: [] } // team-less caller has nothing to approve

  const { data: reqs } = await admin
    .from('team_join_requests')
    .select('id, user_id, created_at')
    .eq('team_id', me.team_id)
    .eq('status', 'pending')
    .order('created_at')

  if (!reqs?.length) return { requests: [] }

  const { data: profiles } = await admin
    .from('users')
    .select('id, display_name')
    .in('id', reqs.map((r) => r.user_id))
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))

  return {
    requests: reqs.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: nameById.get(r.user_id) ?? r.user_id.slice(0, 8),
      createdAt: r.created_at,
    })),
  }
})
