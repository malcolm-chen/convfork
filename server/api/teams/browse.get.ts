// Team directory for the join flow. Returns every team with a member count, the
// caller's current team, and which teams the caller has an outstanding request
// for — enough for the home page to render "join / requested / member" states.

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const admin = useSupabaseAdmin()

  const [{ data: teams }, { data: me }, { data: members }, { data: myReqs }] = await Promise.all([
    admin.from('teams').select('id, name').order('name'),
    admin.from('users').select('team_id').eq('id', user.id).single(),
    admin.from('users').select('team_id'),
    admin.from('team_join_requests').select('team_id, status').eq('user_id', user.id),
  ])

  const counts = new Map<string, number>()
  for (const m of members ?? []) {
    if (m.team_id) counts.set(m.team_id, (counts.get(m.team_id) ?? 0) + 1)
  }
  const pendingTeamIds = (myReqs ?? []).filter((r) => r.status === 'pending').map((r) => r.team_id)

  return {
    myTeamId: me?.team_id ?? null,
    pendingTeamIds,
    teams: (teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      memberCount: counts.get(t.id) ?? 0,
    })),
  }
})
