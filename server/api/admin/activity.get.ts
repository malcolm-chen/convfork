// Read-only admin activity for weekly check-ins (design doc §9).
// team_interaction_logs has NO client select policy, so this reads it with the
// service_role key, gated to users whose profile role is 'researcher', and
// scoped to the caller's own team.

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const admin = useSupabaseAdmin()

  const { data: profile } = await admin
    .from('users')
    .select('team_id, role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'researcher') {
    throw createError({ statusCode: 403, statusMessage: 'researchers only' })
  }

  const teamId = profile.team_id

  const [{ data: interactions }, { data: members }, { count: nodeCount }] = await Promise.all([
    admin
      .from('team_interaction_logs')
      .select('ts, interaction_type, actor_user_id, target_user_id, source_node_id, result_node_id')
      .eq('team_id', teamId)
      .order('ts', { ascending: false })
      .limit(100),
    admin.from('users').select('id, display_name').eq('team_id', teamId),
    admin.from('nodes').select('id', { count: 'exact', head: true }),
  ])

  return { teamId, interactions: interactions ?? [], members: members ?? [], nodeCount: nodeCount ?? 0 }
})
