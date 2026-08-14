// Persists a conversation-node (segment card) title — see server/api/nodes/rename.post.ts.
// The write lands back on every viewer, including the caller, via the
// existing nodes UPDATE realtime subscription (composables/useRealtime.ts),
// so callers don't need to locally patch state on success.
export function useNodeTitle() {
  function rename(nodeId: string, title: string, manual: boolean, hash?: string) {
    return $fetch('/api/nodes/rename', { method: 'POST', body: { nodeId, title, manual, hash } }).catch(() => {
      /* best-effort — an auto-summary retries next render; a manual rename
         the user can simply retry */
    })
  }

  return { rename }
}
