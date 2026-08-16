import type { Ref } from 'vue'
import { segmentize } from '~/composables/useSegments'
import type { TreeNode } from '~/composables/useConversation'
import type { PresenceMeta } from '~/composables/useRealtime'

// Turns the page's existing selection/streaming state into the "someone is
// on this node" signal broadcast over useRealtime's presence channel. The
// avatar itself shows as soon as this conversation is open with a shared
// segment selected — composing/streaming only drive the active-vs-idle
// styling (see TreeNode.vue's idle fade), not whether it shows at all. Only
// a segment with at least one SHARED node may ever be announced — see the
// system architecture doc's privacy model: a private draft never leaks a
// presence signal to teammates who can't even see the card yet.
const ACTIVITY_THROTTLE_MS = 2000
const STREAM_HEARTBEAT_MS = 4000

export function usePresenceActivity(opts: {
  nodes: Ref<TreeNode[]>
  selectedId: Ref<string | null>
  drafting: Ref<boolean>
  isStreaming: Ref<boolean>
  currentUserId: Ref<string>
  trackPresence: (meta: PresenceMeta) => void
  untrackPresence: () => void
}) {
  const { nodes, selectedId, drafting, isStreaming, currentUserId, trackPresence, untrackPresence } = opts

  // The segment (canvas card) the composer is currently pointed at.
  const activeSegmentId = computed(() => {
    if (drafting.value || !selectedId.value) return null
    const seg = segmentize(nodes.value).find((s) => s.nodes.some((n) => n.id === selectedId.value))
    if (!seg || !seg.nodes.some((n) => n.visibility === 'shared')) return null
    return seg.id
  })

  function pulse() {
    const segmentId = activeSegmentId.value
    if (!segmentId || !currentUserId.value) {
      untrackPresence()
      return
    }
    trackPresence({ userId: currentUserId.value, segmentId, updatedAt: Date.now() })
  }

  // Fire the moment there's a valid (shared) segment to show — covers simply
  // opening the conversation (selectedId gets set on mount, see the page's
  // onMounted) as well as switching to a different node later. Composing/
  // streaming below only keep `updatedAt` fresh so the avatar stays in its
  // "active" (non-idle) state while real engagement continues.
  watch(activeSegmentId, () => pulse(), { immediate: true })

  // Keystrokes are frequent; only actually publish at most once every couple
  // seconds; the last keystroke's freshness is close enough for "is this
  // person still active" purposes.
  let lastPulseAt = 0
  function onComposerActivity() {
    const now = Date.now()
    if (now - lastPulseAt < ACTIVITY_THROTTLE_MS) return
    lastPulseAt = now
    pulse()
  }

  // A long generation with no further keystrokes must still read as "active",
  // not fade to idle mid-stream — so re-pulse on an interval for as long as
  // isStreaming stays true, not just once at the start.
  let heartbeat: ReturnType<typeof setInterval> | null = null
  watch(isStreaming, (streaming) => {
    if (streaming) {
      pulse()
      heartbeat = setInterval(pulse, STREAM_HEARTBEAT_MS)
    } else if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  })

  onBeforeUnmount(() => {
    if (heartbeat) clearInterval(heartbeat)
  })

  return { onComposerActivity }
}
