interface Body {
  password?: string
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const adminPassword = (config.adminPassword as string) || ''
  if (!adminPassword) {
    throw createError({
      statusCode: 503,
      statusMessage: 'ADMIN_PASSWORD is not configured on the server',
    })
  }

  const body = await readBody<Body>(event)
  const password = body?.password ?? ''
  if (!password || password !== adminPassword) {
    throw createError({ statusCode: 401, statusMessage: 'Wrong admin password' })
  }

  setAdminCookie(event, adminPassword)
  return { ok: true }
})
