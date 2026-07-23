import type { RealtimeChannel } from '@supabase/supabase-js'
import type { TreeNode, Reaction } from '~/composables/useConversation'

// Subscribes to nodes (INSERT+UPDATE) and reactions (INSERT+DELETE) for a
// conversation. All updates are idempotent upserts-by-id (§8.3). A visibility
// UPDATE that newly reveals a node triggers a lineage delta-fetch, because we
// never received the INSERTs for a teammate's previously-private branch
// (RLS-over-realtime).
export function useRealtime(
  conversationId: string,
  conv: ReturnType<typeof useConversation>,
) {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  let channel: RealtimeChannel | null = null

  function start() {
    channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'nodes', filter: `conversation_id=eq.${conversationId}` },
        (p) => conv.upsert(p.new as TreeNode),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'nodes', filter: `conversation_id=eq.${conversationId}` },
        (p) => {
          const next = p.new as TreeNode
          const prev = p.old as Partial<TreeNode>
          conv.upsert(next)
          if (next.visibility === 'shared' && prev?.visibility !== 'shared') {
            // Pull the revealed branch AND its reactions (get_lineage returns
            // nodes only, so reactions on newly visible nodes need a refetch).
            conv.fetchLineage(next.id).then(() => conv.loadReactions())
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reactions' },
        (p) => {
          const r = p.new as Reaction
          // RLS already limits which reaction inserts reach us; keep only ones on
          // nodes we know about.
          if (conv.nodesById.has(r.node_id)) conv.addReaction(r)
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'reactions' },
        (p) => {
          const old = p.old as Partial<Reaction>
          if (old?.id) conv.removeReaction(old.id, old.node_id)
        },
      )
      // shared→private is invisible to teammates over postgres_changes (RLS
      // authorizes against the NEW row), so the author broadcasts the retracted
      // ids and everyone else drops them from their local tree.
      .on('broadcast', { event: 'retract' }, (p) => {
        // Own nodes stay visible to their author regardless of visibility —
        // guard so the author's other tabs don't drop them.
        const ids = ((p.payload?.ids ?? []) as string[]).filter(
          (id) => conv.nodesById.get(id)?.author_id !== user.value?.id,
        )
        if (ids.length) conv.removeNodes(ids)
      })
      // A member cleared the whole tree server-side. DELETEs don't reach us
      // over postgres_changes (only INSERT/UPDATE are subscribed, and RLS
      // filters others' private rows anyway), so reconcile from the server:
      // load() drops everything the DB no longer returns.
      .on('broadcast', { event: 'cleared' }, () => conv.load())
      .subscribe((status) => {
        // On (re)subscribe, fully reconcile: load() re-reads nodes + reactions
        // and drops anything retracted while disconnected. (deltaFetch alone
        // misses visibility UPDATEs — they don't touch created_at.)
        if (status === 'SUBSCRIBED') conv.load()
      })
  }

  // Author-side announcement for shared→private flips (see broadcast handler).
  function broadcastRetract(ids: string[]) {
    channel?.send({ type: 'broadcast', event: 'retract', payload: { ids } })
  }

  // Initiator-side announcement that the tree was cleared server-side.
  function broadcastCleared() {
    channel?.send({ type: 'broadcast', event: 'cleared', payload: {} })
  }

  function stop() {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }

  return { start, stop, broadcastRetract, broadcastCleared }
}
