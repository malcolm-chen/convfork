// Delete an entire study session: every user, conversation, and piece of
// content on the team, then the team row itself. The session_id becomes free
// again immediately afterward, so re-provisioning it (users.post.ts) creates
// a brand-new team and the "session already exists" check no longer matches
// — letting the researcher pick a different condition for it.

interface Body {
  teamId?: string
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<Body>(event)
  const teamId = body?.teamId?.trim()
  if (!teamId) {
    throw createError({ statusCode: 400, statusMessage: 'teamId is required' })
  }

  const admin = useSupabaseAdmin()

  const { data: members, error: membersErr } = await admin
    .from('users')
    .select('id')
    .eq('team_id', teamId)
  if (membersErr) {
    throw createError({ statusCode: 500, statusMessage: membersErr.message })
  }

  // Purge every conversation/node/etc. on the team BEFORE removing member
  // auth users — same ordering reason as delete_study_user (0024): content
  // tables reference users(id) with no cascade, so it must be gone first.
  const { error: purgeErr } = await admin.rpc('delete_study_session', { target_team: teamId })
  if (purgeErr) {
    throw createError({ statusCode: 500, statusMessage: purgeErr.message })
  }

  for (const member of members ?? []) {
    const { error } = await admin.auth.admin.deleteUser(member.id)
    if (error) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }
  // public.users cascades from each auth.users delete via FK.

  const { error: teamErr } = await admin.from('teams').delete().eq('id', teamId)
  if (teamErr) {
    throw createError({ statusCode: 500, statusMessage: teamErr.message })
  }

  return { ok: true }
})
