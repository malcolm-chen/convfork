import { v4 as uuidv4 } from 'uuid'

// Batched/debounced behavior-log capture (design doc §6.3). Buffers events in
// memory, flushes every ~2s / 20 rows / on tab hide, via sendBeacon → /api/logs
// (server writes to S3). One session_id per login runs through every row.

interface Ref { conversationId?: string; nodeId?: string }
interface Row {
  id: string
  ts: string
  session_id: string
  action_type: string
  action_content: Record<string, unknown>
  conversation_id?: string
  node_id?: string
}

const buf: Row[] = []
let sid: string | null = null
let started = false
let typingTimer: ReturnType<typeof setTimeout> | null = null

function sessionId(): string {
  if (sid) return sid
  if (import.meta.client) {
    sid = sessionStorage.getItem('cf_sid')
    if (!sid) {
      sid = uuidv4()
      sessionStorage.setItem('cf_sid', sid)
    }
  }
  return sid ?? 'ssr'
}

function flush(): void {
  if (!import.meta.client || buf.length === 0) return
  const rows = buf.splice(0)
  const body = JSON.stringify({ sessionId: sessionId(), batchId: uuidv4(), rows })
  const blob = new Blob([body], { type: 'application/json' })
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/logs', blob)
  } else {
    fetch('/api/logs', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    })
  }
}

export function useActionLogger() {
  if (import.meta.client && !started) {
    started = true
    setInterval(flush, 2000)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush()
    })
    window.addEventListener('beforeunload', flush)
  }

  function log(action_type: string, action_content: Record<string, unknown> = {}, ref: Ref = {}): void {
    buf.push({
      id: uuidv4(),
      ts: new Date().toISOString(),
      session_id: sessionId(),
      action_type,
      action_content,
      conversation_id: ref.conversationId,
      node_id: ref.nodeId,
    })
    if (buf.length >= 20) flush()
  }

  // Debounced typing: record a length once after a pause, never per keystroke (§6.5).
  function logTyping(len: number, ref: Ref = {}): void {
    if (typingTimer) clearTimeout(typingTimer)
    typingTimer = setTimeout(() => log('type', { len }, ref), 500)
  }

  return { log, logTyping, flush, sessionId }
}
