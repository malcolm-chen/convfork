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

  // Resolve the team from sessionID FIRST, then look up the user scoped to
  // that team — userID alone is no longer unique across sessions, so a
  // study_user_id-only lookup could match a same-named participant in a
  // different session.
  const { data: team, error: teamErr } = await admin
    .from('teams')
    .select('id')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (teamErr) {
    throw createError({ statusCode: 500, statusMessage: teamErr.message })
  }
  if (!team) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid userID or sessionID' })
  }

  const { data: profile, error } = await admin
    .from('users')
    .select('id')
    .eq('study_user_id', userId)
    .eq('team_id', team.id)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
  if (!profile) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid userID or sessionID' })
  }

  return {
    email: studyEmail(userId, sessionId),
    password: sessionId,
  }
})
