// Behavior-log ingest → S3. Cookie-authenticated (works with sendBeacon).
// Each batch is written as one NDJSON object; the client-supplied batchId makes
// re-uploads idempotent (same key → overwrite, not duplicate).

interface LogRow {
  id?: string
  ts?: string
  session_id?: string
  action_type: string
  action_content?: Record<string, unknown>
  conversation_id?: string
  node_id?: string
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  // sendBeacon may send text/plain; read raw and parse to be content-type-agnostic.
  const raw = await readRawBody(event)
  if (!raw) return { ok: true, written: 0 }
  let payload: { sessionId?: string; batchId?: string; rows?: LogRow[] }
  try {
    payload = JSON.parse(raw.toString())
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' })
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : []
  if (rows.length === 0) return { ok: true, written: 0 }

  const admin = useSupabaseAdmin()
  const { data: profile } = await admin
    .from('users')
    .select('team_id')
    .eq('id', user.id)
    .single()
  const teamId = profile?.team_id ?? 'unknown'

  const sessionId = payload.sessionId || rows[0]?.session_id || 'nosession'
  const batchId = payload.batchId || crypto.randomUUID()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  // Server stamps user_id (never trust the client for identity).
  const ndjson =
    rows.map((r) => JSON.stringify({ ...r, user_id: user.id })).join('\n') + '\n'

  const key = `logs/${teamId}/${user.id}/${sessionId}/${stamp}-${batchId}.ndjson`
  // Behavior logging is research telemetry — best-effort. A misconfigured S3
  // bucket/IAM policy must never break the user's session, so swallow and warn
  // (the client uses sendBeacon and ignores the response anyway).
  try {
    await putLogBatch(key, ndjson)
  } catch (e) {
    console.warn(`[logs] S3 write failed (${rows.length} rows dropped):`, e instanceof Error ? e.message : e)
    return { ok: false, written: 0, dropped: rows.length }
  }

  return { ok: true, written: rows.length, key }
})
