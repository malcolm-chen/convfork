<script setup lang="ts">
import type { PresenceMeta } from '~/composables/useRealtime'

// Shared by TreeNode.vue (segment cards) and MergedNodeCard.vue (a merged
// node also shows presence for anyone currently on a segment forked from it —
// see ReasoningTree.vue's presenceByMergedNode) — factored out rather than
// duplicated since both need the exact same idle-fade/tooltip behavior.
const props = defineProps<{
  presence?: PresenceMeta[]
  memberNames: Record<string, string>
  currentUserId: string
}>()

// A presence entry never disappears on its own once someone's chatted here —
// it just fades to "idle" once their activity goes stale (Google-Docs-style),
// so teammates can still see *where* everyone last worked, not just where
// they're working right this second. `now` only needs to tick while there's
// something to fade, so the timer starts/stops with presence itself.
const IDLE_MS = 9000
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null
watch(
  () => (props.presence?.length ?? 0) > 0,
  (hasPresence) => {
    if (hasPresence && !nowTimer) {
      now.value = Date.now()
      nowTimer = setInterval(() => { now.value = Date.now() }, 2000)
    } else if (!hasPresence && nowTimer) {
      clearInterval(nowTimer)
      nowTimer = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
})

// Includes the viewer's own entry too — confirms the feature is actually
// live for the person typing, same as how a Google Docs/Figma cursor shows
// up for its own owner, not just everyone else. `name` always stays the
// person's real display name (so the avatar's initials/color match every
// other avatar of theirs in the app, e.g. the turn list and "Shared by"
// footer) — only the tooltip's wording swaps in "You" for the viewer.
const presenceUsers = computed(() =>
  (props.presence ?? [])
    .map((p) => {
      const isSelf = p.userId === props.currentUserId
      return {
        userId: p.userId,
        name: props.memberNames[p.userId] ?? 'Someone',
        isSelf,
        idle: now.value - p.updatedAt > IDLE_MS,
      }
    })
    // Self first, then alphabetical — reads naturally as "You and Sam…"
    // rather than "Sam and You…".
    .sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : a.name.localeCompare(b.name))),
)
const PRESENCE_AVATAR_CAP = 3
const visiblePresence = computed(() => presenceUsers.value.slice(0, PRESENCE_AVATAR_CAP))
const presenceOverflow = computed(() => Math.max(0, presenceUsers.value.length - PRESENCE_AVATAR_CAP))
// "Ada is chatting here" / "You are chatting here" / "You and Sam are chatting
// here" / "Ada and 2 others are chatting here".
const presenceTooltip = computed(() => {
  const names = presenceUsers.value.map((p) => (p.isSelf ? 'You' : p.name))
  if (!names.length) return ''
  if (names.length === 1) return names[0] === 'You' ? 'You are chatting here' : `${names[0]} is chatting here`
  if (names.length === 2) return `${names[0]} and ${names[1]} are chatting here`
  return `${names[0]} and ${names.length - 1} others are chatting here`
})

const presenceTipVisible = ref(false)
const presenceTipPos = reactive({ top: 0, left: 0 })
let presenceHideTimer: ReturnType<typeof setTimeout> | null = null
function clearPresenceHideTimer() {
  if (presenceHideTimer != null) {
    clearTimeout(presenceHideTimer)
    presenceHideTimer = null
  }
}
function schedulePresenceHide() {
  clearPresenceHideTimer()
  presenceHideTimer = setTimeout(() => { presenceTipVisible.value = false }, 150)
}
const TIP_WIDTH = 220
function showPresenceTip(ev: MouseEvent) {
  clearPresenceHideTimer()
  presenceTipVisible.value = true
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  presenceTipPos.left = Math.min(rect.left, window.innerWidth - TIP_WIDTH - 12)
  presenceTipPos.top = Math.max(12, rect.top - 10)
}
</script>

<template>
  <!-- Peeks off the card's bottom-right corner, like a facepile badge rather
       than part of the normal layout flow (it must never push the card's own
       content around as people come/go). Positioning is baked in here (not
       left to the host card) so this stays a plain, position-agnostic drop-in
       for any card that needs it. -->
  <div
    v-if="presenceUsers.length"
    class="presence-stack"
    @click.stop
    @mouseenter="showPresenceTip"
    @mouseleave="schedulePresenceHide"
  >
    <UiAvatar
      v-for="p in visiblePresence"
      :key="p.userId"
      class="presence-avatar"
      :class="{ idle: p.idle }"
      :name="p.name"
      :color-key="p.userId"
      :size="20"
    />
    <span v-if="presenceOverflow" class="presence-overflow">+{{ presenceOverflow }}</span>
  </div>

  <!-- Teleported to <body> so this always paints above every canvas node,
       instead of being trapped inside the host card's own vue-flow stacking
       context (mirrors TreeNode.vue's turn-content popover for the same
       reason). -->
  <Teleport to="body">
    <div
      v-if="presenceTipVisible"
      class="presence-tip-portal"
      role="tooltip"
      :style="{ top: presenceTipPos.top + 'px', left: presenceTipPos.left + 'px' }"
      @mouseenter="clearPresenceHideTimer"
      @mouseleave="schedulePresenceHide"
    >
      {{ presenceTooltip }}
    </div>
  </Teleport>
</template>

<style scoped>
/* Deliberately styled differently from every OTHER avatar on the host card
   (turn rows, "Shared by" footer, merge contributor/author avatars): those
   are flat, plain-bordered authorship credits, while a presence avatar gets a
   colored ring that pulses thicker — a live "here right now" signal, not a
   byline. Green (the same hue as the online dot elsewhere in the app), not
   the purple --accent used for selection/highlights, so it doesn't get
   confused with those. The avatar's own initials/color are untouched (still
   driven by the person's real name + userId, same as everywhere else), so
   it's still instantly recognizable as the same person. */
.presence-stack {
  position: absolute;
  right: 8px;
  bottom: -12px;
  z-index: 2;
  display: flex;
  align-items: center;
  cursor: default;
}
.presence-avatar {
  position: relative;
  box-sizing: content-box;
  border-radius: 50%;
  /* Two-tone ring: a card-colored gap (so it reads as a ring, not a smear
     against whatever's behind it) plus the actual presence-colored ring
     outside it. The ring's own thickness pulses (see below) — an obvious
     "still active" tell without adding another shape on top. */
  box-shadow: 0 0 0 2px var(--card), 0 0 0 3px var(--nav-online);
  transition: filter 0.2s ease;
  animation: presence-pulse 1.6s ease-in-out infinite;
}
.presence-avatar:not(:first-child) { margin-left: -5px; }
@keyframes presence-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--card), 0 0 0 3px var(--nav-online); }
  50% { box-shadow: 0 0 0 2px var(--card), 0 0 0 6px var(--nav-online); }
}
/* Faded/desaturated once their activity has gone stale — still shows WHERE
   they last worked, Google-Docs-cursor style, instead of vanishing outright.
   The ring also drops to a neutral gray and stops pulsing: idle specifically
   means "not a live signal right now". Muted via a translucent white veil
   (::after) rather than `opacity`, which would let the card's border/edge
   bleed through the avatar where it overlaps the corner. */
.presence-avatar.idle {
  filter: grayscale(1);
  box-shadow: 0 0 0 2px var(--card), 0 0 0 3px var(--muted);
  animation: none;
}
.presence-avatar.idle::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
  pointer-events: none;
}
.presence-overflow {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-left: -5px;
  box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--muted);
  border-radius: 50%;
  background: var(--muted);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  box-sizing: content-box;
}
.presence-tip-portal {
  position: fixed;
  z-index: 150;
  transform: translateY(-100%);
  max-width: 220px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--ink);
  color: #fff;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.4;
  box-shadow: 0 10px 24px rgba(20, 20, 30, 0.24);
  pointer-events: auto;
}
</style>
