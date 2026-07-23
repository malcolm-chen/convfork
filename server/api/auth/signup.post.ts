// Email/password sign-up. Creates the auth user (email pre-confirmed so they can
// sign in immediately — no inbox round-trip) and a public.users profile. New
// members start team-less (team_id = null, role = 'member'); they pick a team to
// join from the home page afterwards. Profile/team writes need the secret key
// because RLS gives the client no INSERT on users — so this must run server-side.

interface SignupBody {
  email?: string
  password?: string
  displayName?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SignupBody>(event)
  const email = body?.email?.trim().toLowerCase()
  const password = body?.password ?? ''
  const displayName = body?.displayName?.trim()

  if (!email || !password || !displayName) {
    throw createError({ statusCode: 400, statusMessage: 'email, password and displayName are required' })
  }
  if (password.length < 6) {
    throw createError({ statusCode: 400, statusMessage: 'password must be at least 6 characters' })
  }

  const admin = useSupabaseAdmin()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    // Most common: email already registered.
    const msg = createErr?.message ?? 'Could not create account'
    const already = /already|registered|exists/i.test(msg)
    throw createError({ statusCode: already ? 409 : 400, statusMessage: msg })
  }

  // Mirror into public.users (id is the FK/PK to auth.users). team_id stays null
  // until the user is admitted to a team.
  const { error: profileErr } = await admin.from('users').insert({
    id: created.user.id,
    team_id: null,
    display_name: displayName,
    role: 'member',
  })
  if (profileErr) {
    // Roll back the orphaned auth user so the email can be reused cleanly.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    throw createError({ statusCode: 500, statusMessage: `Profile creation failed: ${profileErr.message}` })
  }

  return { ok: true }
})
