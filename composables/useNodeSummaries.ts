// LLM-generated titles for tree cards (ChatGPT-sidebar style), cached so we
// only call the model once per distinct trajectory content. Cache is keyed by a
// hash of the transcript, kept in memory and mirrored to localStorage so titles
// survive reloads and don't re-cost tokens.

type Entry = { text: string; status: 'loading' | 'done' | 'error' }

const cache = reactive(new Map<string, Entry>())
const LS_KEY = 'convfork:summaries:v1'
let hydrated = false
let inflight = 0

// Small, fast, well-distributed string hash (cyrb53) — stable across reloads.
function hash(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16)
}

function hydrate() {
  if (hydrated || !import.meta.client) return
  hydrated = true
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
        cache.set(k, { text: v, status: 'done' })
      }
    }
  } catch {
    /* corrupt / unavailable storage — start empty */
  }
}

function persist() {
  if (!import.meta.client) return
  try {
    const done: Record<string, string> = {}
    for (const [k, v] of cache) if (v.status === 'done') done[k] = v.text
    localStorage.setItem(LS_KEY, JSON.stringify(done))
  } catch {
    /* quota / unavailable — the in-memory cache still works this session */
  }
}

export function useNodeSummaries() {
  hydrate()

  const keyFor = (transcript: string) => hash(transcript)

  // Kick off a summary for this transcript if we don't already have one
  // (or one in flight). Idempotent — safe to call on every render.
  function request(transcript: string) {
    if (!import.meta.client) return
    const key = keyFor(transcript)
    const cur = cache.get(key)
    if (cur && cur.status !== 'error') return
    // Light client-side throttle so opening a big tree doesn't fan out dozens
    // of calls at once; requeue shortly if we're saturated.
    if (inflight >= 4) {
      setTimeout(() => request(transcript), 250)
      return
    }
    cache.set(key, { text: '', status: 'loading' })
    inflight++
    $fetch<{ summary: string }>('/api/summarize', { method: 'POST', body: { text: transcript.slice(0, 6000) } })
      .then((r) => {
        cache.set(key, { text: r.summary, status: 'done' })
        persist()
      })
      .catch(() => cache.set(key, { text: '', status: 'error' }))
      .finally(() => { inflight-- })
  }

  const get = (key: string) => cache.get(key)

  return { keyFor, request, get }
}
