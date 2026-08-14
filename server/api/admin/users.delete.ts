// Delete a study user (auth + profile + everything they authored). Team is
// left in place if others remain.

interface Body {
  id?: string
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<Body>(event)
  const id = body?.id?.trim()
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const admin = useSupabaseAdmin()

  // Nodes/reactions/etc. this user authored reference users(id) with no
  // cascade (see 0024_delete_study_user_cascade.sql) — clean those up (and
  // reparent any teammate forks off this user's nodes) BEFORE deleting the
  // auth user, or the cascade into public.users fails with a foreign-key
  // violation the moment the user has any real activity.
  const { error: cleanupError } = await admin.rpc('delete_study_user', { target_user: id })
  if (cleanupError) {
    throw createError({ statusCode: 500, statusMessage: cleanupError.message })
  }

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
  // public.users cascades from auth.users delete via FK.
  return { ok: true }
})
