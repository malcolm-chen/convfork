// Streams an attachment's bytes back to the browser, gated by the same
// visibility rule as nodes RLS (own node, any visibility; teammate's node,
// only if shared) — never a presigned URL, so access always re-checks live.

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const admin = useSupabaseAdmin()
  const { data: att } = await admin
    .from('attachments')
    .select('s3_key, filename, content_type, node_id, nodes(author_id, visibility, conversation_id)')
    .eq('id', id)
    .single()
  if (!att) throw createError({ statusCode: 404, statusMessage: 'attachment not found' })

  const node = Array.isArray(att.nodes) ? att.nodes[0] : att.nodes
  const nodeInfo = node as { author_id: string; visibility: string; conversation_id: string } | null
  if (!nodeInfo) throw createError({ statusCode: 404, statusMessage: 'attachment not found' })

  if (nodeInfo.author_id !== user.id) {
    if (nodeInfo.visibility !== 'shared') {
      throw createError({ statusCode: 403, statusMessage: 'not visible' })
    }
    const { data: convo } = await admin
      .from('conversations')
      .select('team_id')
      .eq('id', nodeInfo.conversation_id)
      .single()
    const { data: profile } = await admin.from('users').select('team_id').eq('id', user.id).single()
    if (!convo || !profile || profile.team_id !== convo.team_id) {
      throw createError({ statusCode: 403, statusMessage: 'not a member of this team' })
    }
  }

  const bytes = await getUpload(att.s3_key)
  setResponseHeaders(event, {
    'content-type': att.content_type,
    'content-disposition': `inline; filename="${att.filename}"`,
    'cache-control': 'private, max-age=3600',
  })
  return bytes
})
