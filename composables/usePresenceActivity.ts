import type { Ref } from 'vue'
import { segmentize } from '~/composables/useSegments'
import type { TreeNode } from '~/composables/useConversation'
import type { PresenceMeta } from '~/composables/useRealtime'

// Turns the page's existing selection/streaming/hover state into the
// "someone is on this node" signal broadcast over useRealtime's presence
// channel. The avatar itself shows as soon as this conversation is open with
// a shared segment selected, or as soon as a card's content is actually being
// viewed (hovering a turn's preview, see TreeNode.vue's view-segment emit) —
// composing/streaming/hovering only drive the active-vs-idle styling (see
// TreeNode.vue's idle fade), not whether it shows at all. Only a segment with
// at least one SHARED node may ever be announced — see the system
// architecture doc's privacy model: a private draft never leaks a presence
// signal to teammates who can't even see the card yet.
const ACTIVITY_THROTTLE_MS = 2000
const HEARTBEAT_MS = 4000

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
  const composerSegmentId = computed(() => {
    if (drafting.value || !selectedId.value) return null
    const seg = segmentize(nodes.value).find((s) => s.nodes.some((n) => n.id === selectedId.value))
    if (!seg || !seg.nodes.some((n) => n.visibility === 'shared')) return null
    return seg.id
  })

  // Actually looking at a card's content (hovering a turn's preview) is a
  // more concrete "I'm on this node" signal than merely having some other
  // node selected as the composer target, so it wins while it lasts. Cleared
  // the moment the hover genuinely ends — presence then reverts to the
  // composer target rather than lingering on a card no longer being read.
  const hoveredSegmentId = ref<string | null>(null)
  // Supabase Presence turns out to have a low rate limit specifically on
  // track()/untrack() calls (confirmed empirically against this project —
  // plain broadcast messages on the same connection sail through at the same
  // rate, but presence updates start silently timing out after only a
  // handful in quick succession). So switching between cards must cost at
  // most ONE presence update, never two — a naive "clear the old one, then
  // set the new one" would send an untrack immediately followed by a track
  // for every single switch, burning through that budget twice as fast.
  // A "stopped viewing" is therefore held for a brief (imperceptible) moment
  // before actually taking effect; the near-simultaneous "started viewing"
  // that fires when moving straight from one card to another cancels it
  // first, collapsing the whole switch into the one direct track() call for
  // wherever the user ended up.
  const HOVER_CLEAR_GRACE_MS = 120
  let clearTimer: ReturnType<typeof setTimeout> | null = null
  function cancelPendingClear() {
    if (clearTimer != null) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
  }
  function onViewSegment({ segmentId, viewing }: { segmentId: string; viewing: boolean }) {
    if (viewing) {
      cancelPendingClear()
      hoveredSegmentId.value = segmentId
      return
    }
    // Already superseded by a newer hover elsewhere — this "stopped" is a
    // stale signal about a card the user has already moved past.
    if (hoveredSegmentId.value !== segmentId) return
    cancelPendingClear()
    clearTimer = setTimeout(() => {
      clearTimer = null
      if (hoveredSegmentId.value === segmentId) hoveredSegmentId.value = null
    }, HOVER_CLEAR_GRACE_MS)
  }

  const activeSegmentId = computed(() => hoveredSegmentId.value ?? composerSegmentId.value)

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
  // onMounted), switching to a different node, and hovering a different
  // card's content. Composing/streaming/hovering below only keep `updatedAt`
  // fresh so the avatar stays in its "active" (non-idle) state while real
  // engagement continues.
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

  // A long generation (or a long read) with no further keystrokes must still
  // read as "active", not fade to idle partway through — so re-pulse on an
  // interval for as long as EITHER is ongoing, not just once at the start.
  let heartbeat: ReturnType<typeof setInterval> | null = null
  function startHeartbeat() {
    if (!heartbeat) heartbeat = setInterval(pulse, HEARTBEAT_MS)
  }
  function stopHeartbeatUnlessStillActive() {
    if (isStreaming.value || hoveredSegmentId.value) return
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }
  watch(isStreaming, (streaming) => {
    if (streaming) {
      pulse()
      startHeartbeat()
    } else {
      stopHeartbeatUnlessStillActive()
    }
  })
  watch(hoveredSegmentId, (id) => {
    if (id) startHeartbeat()
    else stopHeartbeatUnlessStillActive()
  })

  onBeforeUnmount(() => {
    if (heartbeat) clearInterval(heartbeat)
    cancelPendingClear()
  })

  return { onComposerActivity, onViewSegment }
}
