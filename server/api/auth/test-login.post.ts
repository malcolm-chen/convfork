// One-click test account. Idempotently provisions a fixed researcher user in a
// shared "Test Team" (so the admin/activity views and all team features are
// reachable) and returns its credentials. The CLIENT then signs in with these
// via signInWithPassword, so a normal RLS-bound session is established — no
// special server session minting. Safe to call repeatedly: existing rows reused.

const TEST_EMAIL = 'test@convfork.local'
const TEST_PASSWORD = 'test-convfork-123'
const TEST_TEAM = 'Test Team'
const TEST_NAME = 'Test Researcher'

export default defineEventHandler(async () => {
  const admin = useSupabaseAdmin()

  // 1. Shared test team (by name).
  let teamId: string
  const { data: team } = await admin.from('teams').select('id').eq('name', TEST_TEAM).maybeSingle()
  if (team) {
    teamId = team.id
  } else {
    const { data: newTeam, error } = await admin
      .from('teams')
      .insert({ name: TEST_TEAM })
      .select('id')
      .single()
    if (error || !newTeam) {
      throw createError({ statusCode: 500, statusMessage: `Could not create test team: ${error?.message}` })
    }
    teamId = newTeam.id
  }

  // 2. Auth user — find by email, else create (email pre-confirmed).
  let userId: string | undefined
  // list_users has no email filter in this SDK; page until found (test envs are small).
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    const found = data.users.find((u) => u.email?.toLowerCase() === TEST_EMAIL)
    if (found) userId = found.id
    if (data.users.length < 200) break
  }
  if (!userId) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (error || !created.user) {
      throw createError({ statusCode: 500, statusMessage: `Could not create test user: ${error?.message}` })
    }
    userId = created.user.id
  } else {
    // Only reset the password if the constant no longer works. An admin
    // password update revokes ALL of the user's refresh tokens, so doing it
    // unconditionally logged out every other browser signed in as the test
    // user (they then spam "Invalid Refresh Token" on each SSR render).
    const { createClient } = await import('@supabase/supabase-js')
    const probe = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: probeSession, error: probeErr } = await probe.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    if (probeErr) {
      await admin.auth.admin.updateUserById(userId, { password: TEST_PASSWORD }).catch(() => {})
    } else if (probeSession.session) {
      // Revoke only the probe's own session; leave real sessions untouched.
      await admin.auth.admin.signOut(probeSession.session.access_token, 'local').catch(() => {})
    }
  }

  // 3. Profile: researcher in the test team (upsert keeps it idempotent).
  const { error: profileErr } = await admin.from('users').upsert({
    id: userId,
    team_id: teamId,
    display_name: TEST_NAME,
    role: 'researcher',
  })
  if (profileErr) {
    throw createError({ statusCode: 500, statusMessage: `Could not upsert test profile: ${profileErr.message}` })
  }

  return { email: TEST_EMAIL, password: TEST_PASSWORD }
})
