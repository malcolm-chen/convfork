// Delete a study user (auth + profile). Team is left in place if others remain.

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
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
  // public.users cascades from auth.users delete via FK.
  return { ok: true }
})
