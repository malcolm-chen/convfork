<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import type { Reaction } from '~/composables/useConversation'
import 'vue3-emoji-picker/css'

// Full native (Apple on macOS) emoji picker, loaded lazily + client-only.
const EmojiPicker = defineAsyncComponent(() => import('vue3-emoji-picker'))

const PIN = '📌' // dedicated quick-pin reaction (feeds the dashboard "Pinned" rail)

const props = defineProps<{
  reactions: Reaction[]
  currentUserId: string
  memberNames?: Record<string, string>
}>()
const emit = defineEmits<{
  (e: 'react', emoji: string): void
  (e: 'unreact', payload: { id: string; nodeId: string; type: string }): void
}>()

// Group the segment's reactions by emoji, most-used first. Pin is handled by its
// own button, so it's excluded from the general pills.
interface Grp {
  emoji: string
  count: number
  mine: boolean
  names: string[] // display names for the hover tip, "You" first when applicable
}
function nameOf(userId: string) {
  if (userId === props.currentUserId) return 'You'
  return props.memberNames?.[userId] ?? 'Someone'
}
const grouped = computed<Grp[]>(() => {
  const m = new Map<string, { emoji: string; userIds: string[] }>()
  for (const r of props.reactions) {
    if (r.type === PIN) continue
    const g = m.get(r.type) ?? { emoji: r.type, userIds: [] }
    if (!g.userIds.includes(r.user_id)) g.userIds.push(r.user_id)
    m.set(r.type, g)
  }
  return [...m.values()]
    .map((g) => {
      const mine = g.userIds.includes(props.currentUserId)
      // Put "You" first so the tip reads naturally.
      const ordered = mine
        ? [props.currentUserId, ...g.userIds.filter((id) => id !== props.currentUserId)]
        : g.userIds
      return {
        emoji: g.emoji,
        count: g.userIds.length,
        mine,
        names: ordered.map(nameOf),
      }
    })
    .sort((a, b) => b.count - a.count)
})
// At most 3 pills; the rest collapse into a "…" chip that reveals all on hover.
const shown = computed(() => grouped.value.slice(0, 3))
const overflow = computed(() => grouped.value.slice(3))

const pinUsers = computed(() => {
  const ids: string[] = []
  for (const r of props.reactions) {
    if (r.type === PIN && !ids.includes(r.user_id)) ids.push(r.user_id)
  }
  const mine = ids.includes(props.currentUserId)
  const ordered = mine
    ? [props.currentUserId, ...ids.filter((id) => id !== props.currentUserId)]
    : ids
  return { count: ids.length, mine, names: ordered.map(nameOf) }
})
const pinCount = computed(() => pinUsers.value.count)
const pinnedByMe = computed(() => pinUsers.value.mine)

const open = ref(false)
const root = ref<HTMLElement | null>(null)

// Clicking an emoji you already left removes it; otherwise adds it.
function toggle(emoji: string) {
  if (!emoji) return
  const mine = props.reactions.find(
    (r) => r.type === emoji && r.user_id === props.currentUserId,
  )
  if (mine) emit('unreact', { id: mine.id, nodeId: mine.node_id, type: mine.type })
  else emit('react', emoji)
}
function onPick(e: any) {
  toggle(e?.i ?? e?.emoji ?? '')
  open.value = false
}
function togglePicker() {
  open.value = !open.value
}
function onDocClick(ev: MouseEvent) {
  if (open.value && root.value && !root.value.contains(ev.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="rbar">
    <!-- existing reactions (up to 3) as Slack-style pills -->
    <button
      v-for="g in shown"
      :key="g.emoji"
      class="pill"
      :class="{ on: g.mine }"
      :title="g.mine ? 'Click to remove' : 'Add this reaction'"
      @click.stop="toggle(g.emoji)"
    >
      <span class="e">{{ g.emoji }}</span><span class="c">{{ g.count }}</span>
      <span class="tip" role="tooltip">{{ g.names.join(', ') }}</span>
    </button>

    <!-- overflow: hover the … chip to see them all -->
    <div v-if="overflow.length" class="ovf">
      <span class="pill dots">…</span>
      <div class="ovfpop nowheel">
        <button
          v-for="g in overflow"
          :key="g.emoji"
          class="pill"
          :class="{ on: g.mine }"
          :title="g.mine ? 'Click to remove' : 'Add this reaction'"
          @click.stop="toggle(g.emoji)"
        >
          <span class="e">{{ g.emoji }}</span><span class="c">{{ g.count }}</span>
          <span class="tip" role="tooltip">{{ g.names.join(', ') }}</span>
        </button>
      </div>
    </div>

    <!-- add reaction (Google Material add_reaction) → full emoji picker -->
    <div class="addwrap">
      <button class="add" :class="{ active: open }" title="Add reaction" @click.stop="togglePicker">
        <AppIcon name="add-reaction" :size="16" />
      </button>
      <div v-if="open" class="pickerpop nowheel" @click.stop @wheel.stop>
        <ClientOnly>
          <EmojiPicker :native="true" theme="light" @select="onPick" />
        </ClientOnly>
      </div>
    </div>

    <!-- quick pin, next to add-reaction — click again to unpin -->
    <button
      class="pin"
      :class="{ on: pinnedByMe }"
      :title="pinnedByMe ? 'Click to unpin' : 'Pin this branch'"
      @click.stop="toggle(PIN)"
    >
      <span class="e">{{ PIN }}</span><span v-if="pinCount" class="c">{{ pinCount }}</span>
      <span v-if="pinCount" class="tip" role="tooltip">{{ pinUsers.names.join(', ') }}</span>
    </button>
  </div>
</template>

<style scoped>
.rbar { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; }

.pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 1px 7px 1px 6px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}
.pill:hover { border-color: var(--accent); }
.pill.on { background: var(--accent-soft); border-color: var(--accent); }
.pill .e { font-size: 12px; line-height: 1; }
.pill .c { font-size: 10.5px; font-weight: 600; color: var(--accent); }
.pill.dots { padding: 1px 8px; color: var(--muted); font-weight: 700; cursor: default; }

/* who-reacted hover tip (Slack-style) */
.tip {
  display: none;
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 35;
  max-width: 180px;
  padding: 5px 8px;
  border-radius: 7px;
  background: #1d2029;
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  white-space: normal;
  text-align: center;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(29, 32, 41, 0.28);
}
.pill:hover > .tip,
.pin:hover > .tip { display: block; }

/* overflow hover popover */
.ovf { position: relative; display: inline-flex; }
.ovfpop {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: none;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 190px;
  max-height: 150px;
  overflow-y: auto;
  padding: 6px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 10px 26px rgba(29, 32, 41, 0.16);
}
.ovf:hover .ovfpop { display: flex; }

/* add-reaction + quick-pin controls */
.addwrap { position: relative; display: inline-flex; }
.add, .pin {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 0;
  background: none;
  color: var(--muted);
  border-radius: 7px;
  padding: 2px 5px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.add:hover, .add.active, .pin:hover { background: var(--accent-soft); color: var(--accent); }
.pin .e { font-size: 13px; line-height: 1; }
.pin .c { font-size: 10.5px; font-weight: 600; color: var(--accent); }
.pin.on { background: var(--accent-soft); }

.pickerpop {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 40;
}
/* Sized to the 300×~120 card — roughly 3/4 width, not taller than ~2 cards. */
.pickerpop :deep(.v3-emoji-picker) {
  width: 228px;
  height: 236px;
  box-shadow: 0 10px 28px rgba(29, 32, 41, 0.2);
  border-radius: 10px;
  font-size: 12px;
}
.pickerpop :deep(.v3-header) { padding: 6px 8px 4px; }
.pickerpop :deep(.v3-search input) {
  height: 28px;
  font-size: 12px;
  padding: 0 8px;
}
.pickerpop :deep(.v3-body) { padding: 0 4px 6px; }
.pickerpop :deep(.v3-groups) { padding: 2px 4px; gap: 0; }
.pickerpop :deep(.v3-groups button) { width: 24px; height: 24px; }
.pickerpop :deep(.v3-emojis) {
  font-size: 16px;
  padding: 0 2px;
}
.pickerpop :deep(.v3-emojis button) {
  width: 28px;
  height: 28px;
  min-width: 28px;
}
.pickerpop :deep(.v3-footer) { padding: 4px 8px; display: none; }
</style>
