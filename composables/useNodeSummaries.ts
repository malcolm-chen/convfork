// LLM-generated titles for tree cards (ChatGPT-sidebar style). The result is
// persisted server-side onto the segment's head node (nodes.title, see
// server/api/nodes/rename.post.ts / useNodeTitle.ts) and synced to every team
// member over realtime — this composable's own cache is just an in-session,
// in-memory de-dupe (keyed by a hash of the transcript) so opening the same
// tree twice, or two team members viewing at once, doesn't fan out duplicate
// LLM calls for content nothing has actually changed.

type Entry = { text: string; status: 'loading' | 'done' | 'error' }

const cache = reactive(new Map<string, Entry>())
let inflight = 0
// Per-key retry count, only for the auto-backoff below — a transient network
// or model hiccup shouldn't leave a card stuck showing "Untitled branch" for
// the rest of the session just because the one request that happened to run
// failed.
const retries = new Map<string, number>()
const MAX_RETRIES = 3

// Small, fast, well-distributed string hash (cyrb53) — stable across reloads,
// also stored as nodes.title_hash so a client can tell an existing DB title
// apart from stale (segment has grown since it was generated).
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

export function useNodeSummaries() {
  const keyFor = (transcript: string) => hash(transcript)

  // Kick off a summary for this transcript if we don't already have one
  // (or one in flight) cached THIS session. Idempotent — safe to call on
  // every render. `model` should be whichever backbone the trajectory itself
  // already used, so the summary call stays on a provider the team actually
  // has configured instead of silently defaulting to a fixed backbone.
  function request(transcript: string, model?: string | null) {
    if (!import.meta.client) return
    const key = keyFor(transcript)
    const cur = cache.get(key)
    if (cur && cur.status !== 'error') return
    // Light client-side throttle so opening a big tree doesn't fan out dozens
    // of calls at once; requeue shortly if we're saturated.
    if (inflight >= 4) {
      setTimeout(() => request(transcript, model), 250)
      return
    }
    cache.set(key, { text: '', status: 'loading' })
    inflight++
    $fetch<{ summary: string }>('/api/summarize', { method: 'POST', body: { text: transcript.slice(0, 6000), model } })
      .then((r) => {
        retries.delete(key)
        cache.set(key, { text: r.summary, status: 'done' })
      })
      .catch(() => {
        const attempt = (retries.get(key) ?? 0) + 1
        if (attempt <= MAX_RETRIES) {
          // Keep showing the loading shimmer through the retry — only a card
          // that's exhausted its retries should ever fall back to the static
          // "Untitled branch" text. Clear the entry (rather than leaving it
          // 'loading') so the retried request() call isn't a no-op against
          // its own still-'loading' de-dupe guard above.
          retries.set(key, attempt)
          setTimeout(() => {
            cache.delete(key)
            request(transcript, model)
          }, attempt * 1500)
          return
        }
        retries.delete(key)
        cache.set(key, { text: '', status: 'error' })
      })
      .finally(() => { inflight-- })
  }

  const get = (key: string) => cache.get(key)

  return { keyFor, request, get }
}
