import type { RealtimeChannel } from '@supabase/supabase-js'

// Team-wide "a project was created" signal. Before this, conversations was
// never in the postgres_changes path anywhere (useRealtime's channel is
// per-already-open conversation and only covers nodes/reactions/attachments;
// the dashboard's home channel only watches the viewer's own users row), and
// `conversations` was never added to the supabase_realtime publication either
// (see migration 0028) — so teammates only ever saw a new project after a
// manual refresh or a fresh page load. This gives every open tab — dashboard
// or inside another conversation — a live nudge to refetch the list.
export function useConversationsRealtime(onInsert: () => void) {
  const supabase = useSupabaseClient()
  let channel: RealtimeChannel | null = null

  // Takes teamId per-call (rather than once at construction) since a caller's
  // team_id can change after mount — e.g. index.vue's own self-profile
  // UPDATE handler assigns a first team post-login — and a stale closed-over
  // id would silently subscribe to the wrong (or no) team forever.
  function start(teamId: string) {
    if (!teamId) return
    channel = supabase
      .channel(`team-conversations:${teamId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations', filter: `team_id=eq.${teamId}` },
        () => onInsert(),
      )
      .subscribe()
  }

  function stop() {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }

  return { start, stop }
}
