// Optional research-artifact capture (design doc §6.2 richer-than-tree). Stores
// an HTML serialization or a screenshot blob to S3, referenced by node/session.
// Built but unused by default — call from the client only where a snapshot is
// wanted (the immutable node tree already reconstructs what the user saw).

interface SnapBody {
  sessionId?: string
  nodeId?: string
  kind?: 'html' | 'image'
  contentType?: string
  data: string
  encoding?: 'utf8' | 'base64'
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<SnapBody>(event)
  if (!body?.data) throw createError({ statusCode: 400, statusMessage: 'data required' })

  const admin = useSupabaseAdmin()
  const { data: profile } = await admin.from('users').select('team_id').eq('id', user.id).single()
  const teamId = profile?.team_id ?? 'unknown'

  const ext = body.kind === 'image' ? 'png' : 'html'
  const contentType = body.contentType ?? (body.kind === 'image' ? 'image/png' : 'text/html')
  const payload = body.encoding === 'base64' ? Buffer.from(body.data, 'base64') : body.data
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const key = `snapshots/${teamId}/${user.id}/${body.sessionId ?? 'nosession'}/${stamp}-${body.nodeId ?? 'na'}.${ext}`

  // Best-effort like the log sink: never fail the request on an S3/IAM problem.
  try {
    await putSnapshot(key, payload, contentType)
  } catch (e) {
    console.warn('[snapshot] S3 write failed:', e instanceof Error ? e.message : e)
    return { ok: false }
  }
  return { ok: true, key }
})
