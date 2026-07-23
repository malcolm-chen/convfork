export default defineEventHandler(async (event) => {
  clearAdminCookie(event)
  return { ok: true }
})
