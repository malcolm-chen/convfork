// Public attachment bytes for a share link — same streaming approach as
// server/api/attachments/[id].get.ts, but gated by "is this attachment's
// node part of THIS share's frozen lineage" instead of a logged-in user's
// own visibility, since visitors here are unauthenticated.

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const attId = getRouterParam(event, 'attId')
  if (!id || !attId) throw createError({ statusCode: 400, statusMessage: 'id and attId required' })

  const admin = useSupabaseAdmin()
  const att = await attachmentNodeInShare(admin, id, attId)
  if (!att) throw createError({ statusCode: 404, statusMessage: 'attachment not found' })

  const bytes = await getUpload(att.s3_key)
  setResponseHeaders(event, {
    'content-type': att.content_type,
    'content-disposition': `inline; filename="${att.filename}"`,
    'cache-control': 'public, max-age=3600',
  })
  return bytes
})
