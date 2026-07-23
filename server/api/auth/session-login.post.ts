// Validate userID + sessionID against admin-provisioned rows, then return
// synthetic email/password so the client can establish a normal Supabase session.

interface Body {
  userId?: string
  sessionId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const userId = validateStudyUserId(body?.userId ?? '')
  const sessionId = validateSessionId(body?.sessionId ?? '')

  const admin = useSupabaseAdmin()

  const { data: profile, error } = await admin
    .from('users')
    .select('id, study_user_id, team_id')
    .eq('study_user_id', userId)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
  if (!profile?.team_id) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid userID or sessionID' })
  }

  const { data: team, error: teamErr } = await admin
    .from('teams')
    .select('session_id')
    .eq('id', profile.team_id)
    .maybeSingle()

  if (teamErr) {
    throw createError({ statusCode: 500, statusMessage: teamErr.message })
  }
  if (!team?.session_id || team.session_id !== sessionId) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid userID or sessionID' })
  }

  return {
    email: studyEmail(userId),
    password: sessionId,
  }
})
