// Provision a study participant: create auth user + profile, find-or-create the
// team for the given sessionID. Everyone sharing a sessionID lands on one team.
// sharing_condition is set when the session team is first created.

interface Body {
  userId?: string
  sessionId?: string
  displayName?: string
  condition?: string
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const body = await readBody<Body>(event)
  const userId = validateStudyUserId(body?.userId ?? '')
  const sessionId = validateSessionId(body?.sessionId ?? '')
  const displayName = (body?.displayName?.trim() || userId)
  const condition = validateSharingCondition(body?.condition ?? 'selective_sharing')

  const admin = useSupabaseAdmin()
  const email = studyEmail(userId)

  // Reject duplicate study_user_id early (clearer than relying on unique index).
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('study_user_id', userId)
    .maybeSingle()
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `userID "${userId}" already exists` })
  }

  // 1. Find or create the team for this sessionID.
  let teamId: string
  let teamName: string
  let sharingCondition: SharingCondition
  const { data: team } = await admin
    .from('teams')
    .select('id, name, sharing_condition')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (team) {
    teamId = team.id
    teamName = team.name
    sharingCondition = (team.sharing_condition as SharingCondition) || 'selective_sharing'
    // Session already exists — keep its condition (ignore a mismatched dropdown).
  } else {
    teamName = `Session ${sessionId}`
    const { data: created, error: teamErr } = await admin
      .from('teams')
      .insert({ name: teamName, session_id: sessionId, sharing_condition: condition })
      .select('id, name, sharing_condition')
      .single()
    if (teamErr || !created) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not create team: ${teamErr?.message}`,
      })
    }
    teamId = created.id
    teamName = created.name
    sharingCondition = created.sharing_condition as SharingCondition
  }

  // 2. Auth user (password = sessionID so login is userID + sessionID).
  const { data: createdAuth, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: sessionId,
    email_confirm: true,
    user_metadata: { study_user_id: userId, session_id: sessionId },
  })
  if (createErr || !createdAuth.user) {
    const msg = createErr?.message ?? 'Could not create auth user'
    const already = /already|registered|exists/i.test(msg)
    throw createError({ statusCode: already ? 409 : 400, statusMessage: msg })
  }

  // 3. Profile linked to the session team.
  const { error: profileErr } = await admin.from('users').insert({
    id: createdAuth.user.id,
    team_id: teamId,
    display_name: displayName,
    role: 'member',
    study_user_id: userId,
  })
  if (profileErr) {
    await admin.auth.admin.deleteUser(createdAuth.user.id).catch(() => {})
    throw createError({
      statusCode: 500,
      statusMessage: `Profile creation failed: ${profileErr.message}`,
    })
  }

  return {
    ok: true,
    user: {
      id: createdAuth.user.id,
      studyUserId: userId,
      displayName,
      sessionId,
      teamId,
      teamName,
      sharingCondition,
    },
  }
})
