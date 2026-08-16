import type { RealtimeChannel } from '@supabase/supabase-js'

// Team-wide "who has the app open right now" — distinct from useRealtime's
// per-conversation "who's chatting on this node" signal (that one is scoped
// to a single conversation and gated by node visibility). This one is scoped
// to the whole team and is just plain online/offline, so SideNav's member
// list can show real teammates' presence instead of only ever marking the
// signed-in user themselves as online.
export function useTeamPresence(teamId: string) {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  let channel: RealtimeChannel | null = null
  const onlineIds = shallowRef<Set<string>>(new Set())

  function start() {
    if (!teamId || !user.value?.id) return
    // Presence key = the user's own id, so multiple open tabs from the same
    // person collapse into one entry and presenceState()'s keys double as
    // the online-id set directly, with no manual de-dup by payload needed.
    channel = supabase
      .channel(`team:${teamId}`, { config: { presence: { key: user.value.id } } })
      .on('presence', { event: 'sync' }, () => {
        onlineIds.value = new Set(Object.keys(channel?.presenceState() ?? {}))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel?.track({ onlineAt: Date.now() })
      })
  }

  function stop() {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }

  return { start, stop, onlineIds }
}
