// List all study users + their session/team for the admin provisioning UI.

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const admin = useSupabaseAdmin()

  const { data: users, error } = await admin
    .from('users')
    .select('id, study_user_id, display_name, role, team_id, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const teamIds = [...new Set((users ?? []).map((u) => u.team_id).filter(Boolean))] as string[]
  const teamById = new Map<string, {
    name: string
    session_id: string | null
    sharing_condition: string | null
  }>()
  if (teamIds.length) {
    const { data: teams, error: teamErr } = await admin
      .from('teams')
      .select('id, name, session_id, sharing_condition')
      .in('id', teamIds)
    if (teamErr) {
      throw createError({ statusCode: 500, statusMessage: teamErr.message })
    }
    for (const t of teams ?? []) {
      teamById.set(t.id, {
        name: t.name,
        session_id: t.session_id,
        sharing_condition: t.sharing_condition,
      })
    }
  }

  return {
    users: (users ?? []).map((u) => {
      const team = u.team_id ? teamById.get(u.team_id) : null
      return {
        id: u.id,
        studyUserId: u.study_user_id as string | null,
        displayName: u.display_name as string,
        role: u.role as string | null,
        teamId: u.team_id as string | null,
        sessionId: team?.session_id ?? null,
        teamName: team?.name ?? null,
        sharingCondition: (team?.sharing_condition as SharingCondition | null) ?? null,
        createdAt: u.created_at as string,
      }
    }),
  }
})
