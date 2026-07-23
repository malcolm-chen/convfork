export default defineEventHandler(async (event) => {
  return { ok: isAdminAuthenticated(event) }
})
