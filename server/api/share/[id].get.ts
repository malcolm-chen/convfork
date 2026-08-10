// Public, unauthenticated read of a share link's frozen lineage — visitors
// following the link never log in, so this intentionally skips requireUser
// and goes straight through the service_role admin client (RLS on
// conversations/nodes would otherwise block them outright).

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const admin = useSupabaseAdmin()
  const content = await loadShareContent(admin, id)
  if (!content) throw createError({ statusCode: 404, statusMessage: 'share link not found' })
  return content
})
