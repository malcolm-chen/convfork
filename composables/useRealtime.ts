import type { RealtimeChannel } from '@supabase/supabase-js'
import type { TreeNode, Reaction, Attachment } from '~/composables/useConversation'

// Who's actively chatting on which segment (canvas card) right now — a live,
// ephemeral signal, unlike everything else this file syncs. Never persisted:
// consumers derive "idle" purely from how stale `updatedAt` has gotten.
export interface PresenceMeta {
  userId: string
  segmentId: string
  updatedAt: number
}

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

  // Who's on which segment right now — built from plain `broadcast` messages,
  // NOT Supabase Presence. Presence turned out to have a low, hard rate limit
  // specific to this project (confirmed empirically: track()/untrack() calls
  // start silently timing out after only a handful in quick succession, while
  // plain broadcasts at the same rate never fail) — anyone switching between
  // more than a few nodes in one session would eventually stop updating for
  // everyone. Broadcast has no such ceiling, so presence rides on it instead,
  // with this map as the only state (keyed by userId, so a fresh update for
  // someone always just overwrites their old one — no accumulation to
  // dedupe, unlike Presence's own multi-meta-per-connection behavior).
  const presenceByUser = reactive(new Map<string, PresenceMeta>())
  // Broadcast has no built-in "this connection disconnected" notification
  // (unlike Presence), so a genuinely gone user (closed tab, crashed) is only
  // ever detected by their entry going stale — pruned well past the UI's own
  // idle-fade threshold (TreeNode.vue's IDLE_MS), so it reads as "idle" for a
  // while before actually disappearing, rather than snapping away right when
  // idle styling would otherwise kick in.
  const PRESENCE_GONE_MS = 30000
  let pruneTimer: ReturnType<typeof setInterval> | null = null

  const presenceBySegment = computed(() => {
    const map = new Map<string, PresenceMeta[]>()
    for (const meta of presenceByUser.values()) {
      const arr = map.get(meta.segmentId) ?? []
      arr.push(meta)
      map.set(meta.segmentId, arr)
    }
    return map
  })

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
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attachments' },
        (p) => {
          const a = p.new as Attachment
          // RLS already limits which attachment inserts reach us; keep only
          // ones on nodes we know about (mirrors the reactions handler above).
          if (conv.nodesById.has(a.node_id)) conv.addAttachment(a)
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
      // The reverse direction has the same problem, just the other way round:
      // a teammate wasn't authorized to see this row before the update, and
      // Realtime's per-subscriber RLS check for postgres_changes doesn't
      // reliably deliver an UPDATE that newly reveals a row to someone who
      // couldn't select it beforehand (same root cause as the retract case
      // above, mirrored) — so the author also broadcasts which ids just
      // became shared, and everyone else pulls them in via a normal
      // (RLS-authorized, now-succeeding) fetch instead of waiting on an
      // UPDATE event that may never arrive.
      .on('broadcast', { event: 'reveal' }, (p) => {
        const ids = (p.payload?.ids ?? []) as string[]
        if (!ids.length) return
        Promise.all(ids.map((id) => conv.fetchLineage(id))).then(() => conv.loadReactions())
      })
      // A member cleared the whole tree server-side. DELETEs don't reach us
      // over postgres_changes (only INSERT/UPDATE are subscribed, and RLS
      // filters others' private rows anyway), so reconcile from the server:
      // load() drops everything the DB no longer returns.
      .on('broadcast', { event: 'cleared' }, () => conv.load())
      // Live "who's chatting where" — see PresenceMeta above. This has no RLS
      // of its own (same as retract/reveal above), so the *caller*
      // (usePresenceActivity) must never announce a segment that isn't
      // already shared; this side just relays whatever it's given.
      .on('broadcast', { event: 'presence-update' }, (p) => {
        const meta = p.payload as PresenceMeta
        if (meta?.userId && meta.segmentId) presenceByUser.set(meta.userId, meta)
      })
      .on('broadcast', { event: 'presence-leave' }, (p) => {
        const userId = p.payload?.userId as string | undefined
        if (userId) presenceByUser.delete(userId)
      })
      .subscribe((status) => {
        // On (re)subscribe, fully reconcile: load() re-reads nodes + reactions
        // and drops anything retracted while disconnected. (deltaFetch alone
        // misses visibility UPDATEs — they don't touch created_at.)
        if (status === 'SUBSCRIBED') conv.load()
      })

    // Catches a teammate's tab closing/crashing without sending
    // presence-leave (see stop() below for the graceful-navigation path).
    pruneTimer = setInterval(() => {
      const cutoff = Date.now() - PRESENCE_GONE_MS
      for (const [userId, meta] of presenceByUser) {
        if (meta.updatedAt < cutoff) presenceByUser.delete(userId)
      }
    }, 10000)
  }

  // Author-side announcement for shared→private flips (see broadcast handler).
  function broadcastRetract(ids: string[]) {
    channel?.send({ type: 'broadcast', event: 'retract', payload: { ids } })
  }

  // Author-side announcement for private→shared flips (see broadcast handler).
  function broadcastReveal(ids: string[]) {
    channel?.send({ type: 'broadcast', event: 'reveal', payload: { ids } })
  }

  // Initiator-side announcement that the tree was cleared server-side.
  function broadcastCleared() {
    channel?.send({ type: 'broadcast', event: 'cleared', payload: {} })
  }

  // Publishes (or refreshes) this client's own "I'm on this segment" signal.
  // Updates the local map immediately (so the sender sees their own "You"
  // entry without waiting on a round trip — broadcasts aren't delivered back
  // to their own sender by default) and broadcasts it out for everyone else.
  function trackPresence(meta: PresenceMeta) {
    presenceByUser.set(meta.userId, meta)
    channel?.send({ type: 'broadcast', event: 'presence-update', payload: meta })
  }

  // Drops this client's presence entirely — used when there's no valid
  // (shared) segment to attach it to, e.g. starting a new private draft.
  function untrackPresence() {
    if (!user.value?.id) return
    presenceByUser.delete(user.value.id)
    channel?.send({ type: 'broadcast', event: 'presence-leave', payload: { userId: user.value.id } })
  }

  function stop() {
    if (channel) {
      // Best-effort: tell everyone else this connection is gone right away,
      // rather than waiting for the stale-entry pruning above to catch it —
      // covers ordinary navigation away, though not a hard crash/tab close.
      untrackPresence()
      supabase.removeChannel(channel)
      channel = null
    }
    if (pruneTimer) {
      clearInterval(pruneTimer)
      pruneTimer = null
    }
  }

  return {
    start,
    stop,
    broadcastRetract,
    broadcastReveal,
    broadcastCleared,
    trackPresence,
    untrackPresence,
    presenceBySegment,
  }
}
