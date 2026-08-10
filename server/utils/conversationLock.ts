// In-process per-conversation mutex. Guards only the part of concept
// tagging that reads-then-writes the shared per-conversation concept
// registry (server/api/concepts/assign.post.ts) — every segment on a canvas
// tags in parallel on page load, and without this, concurrent requests each
// read the registry before earlier ones had committed their inserts,
// producing near-duplicate concepts despite the reuse/dedup checks.
//
// Deliberately in-memory rather than a DB-level lock: this is a single
// Nitro process at this project's scale, and different conversations never
// block each other. The slow part of tagging (understanding the whole
// conversation) deliberately happens OUTSIDE this lock so requests for
// different segments still run concurrently — only the fast registry
// resolve-and-write step serializes.
const queues = new Map<string, Promise<unknown>>()

export function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(conversationId) ?? Promise.resolve()
  const run = () => fn()
  const result = prev.then(run, run)
  queues.set(conversationId, result.then(() => undefined, () => undefined))
  return result
}
