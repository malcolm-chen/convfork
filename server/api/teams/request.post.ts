// Request to join a team. Upserts a pending row keyed on (team_id, user_id), so
// re-requesting after a rejection simply reopens the request. The caller's
// identity is taken from the auth cookie — never from the body.

interface Body { teamId?: string }

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { teamId } = await readBody<Body>(event)
  if (!teamId) throw createError({ statusCode: 400, statusMessage: 'teamId required' })

  const admin = useSupabaseAdmin()

  const { data: me } = await admin.from('users').select('team_id').eq('id', user.id).single()
  if (me?.team_id === teamId) {
    throw createError({ statusCode: 409, statusMessage: 'You are already a member of this team' })
  }

  const { data: team } = await admin.from('teams').select('id').eq('id', teamId).maybeSingle()
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })

  const { error } = await admin.from('team_join_requests').upsert(
    { team_id: teamId, user_id: user.id, status: 'pending', decided_at: null, decided_by: null },
    { onConflict: 'team_id,user_id' },
  )
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { ok: true }
})
