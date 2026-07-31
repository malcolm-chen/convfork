<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { TreeNode, Reaction } from '~/composables/useConversation'
import { turnNumberOf, type Segment } from '~/composables/useSegments'

// One card = one conversation trajectory (segment), not one turn.
const props = defineProps<{
  segment: Segment<TreeNode>
  /** This segment's position in the team's shared order (C1, C2, …); null if never shared. */
  sharedIndex: number | null
  reactionsByNode: Map<string, Reaction[]>
  selectedId: string | null
  currentUserId: string
  memberNames: Record<string, string>
  showVisibility?: boolean
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'fork', id: string): void
  (e: 'react', payload: { nodeId: string; type: string }): void
  (e: 'unreact', payload: { id: string; nodeId: string; type: string }): void
}>()

const tip = computed(() => props.segment.tip)
const isSelected = computed(() => props.segment.nodes.some((n) => n.id === props.selectedId))

// The trajectory belongs to whoever started it (first user turn).
const starter = computed(
  () => props.segment.nodes.find((n) => n.role === 'user') ?? props.segment.head,
)
const authorName = computed(() => props.memberNames[starter.value.author_id] ?? 'Unknown')

const allShared = computed(() => props.segment.nodes.every((n) => n.visibility === 'shared'))
const anyShared = computed(() => props.segment.nodes.some((n) => n.visibility === 'shared'))
const visTitle = computed(() =>
  allShared.value ? 'shared' : anyShared.value ? 'partly shared' : 'private',
)

// Reactions anyone left anywhere on the trajectory; new ones attach to the
// HEAD node — its id is stable for the segment's lifetime.
const segReactions = computed(() =>
  props.segment.nodes.flatMap((n) => props.reactionsByNode.get(n.id) ?? []),
)

// ── Auto-summary (ChatGPT-sidebar style) instead of raw turns ──
const summaries = useNodeSummaries()
const transcript = computed(() =>
  props.segment.nodes
    .map((n) => `${n.role === 'assistant' ? 'Assistant' : 'User'}: ${n.content}`)
    .join('\n\n'),
)
const sumKey = computed(() => summaries.keyFor(transcript.value))
const entry = computed(() => summaries.get(sumKey.value))
watch(transcript, (t) => summaries.request(t), { immediate: true })

const title = computed(() => {
  const e = entry.value
  return e?.status === 'done' && e.text ? e.text : null
})
const loading = computed(() => !title.value && entry.value?.status !== 'error')

// Never leave the card blank if summarizing fails — fall back to the opener.
function oneline(text: string, len = 70) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean || '(empty)'
}
const fallback = computed(() => oneline(starter.value.content))

// "C1"/"C2"/… badge — the segment's position in the team's shared order.
// Never-shared segments show no badge (see useSegments.sharedOrder).
const shortTag = computed(() => (props.sharedIndex != null ? `C${props.sharedIndex}` : null))
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
const turnTime = computed(() => fmtTime(tip.value.created_at))

// Every turn after the opener gets its own row (a growing numbered list). No
// cap/folding — the card grows in height to show the whole trajectory.
const restNodes = computed(() => props.segment.nodes.slice(1))

// Invisible vue-flow source anchors, one per node, co-located with that turn's
// dot so a fork edge connects to the exact turn it was forked from rather than
// the card's vertical middle. Inline styles (which beat vue-flow's own handle
// positioning classes) pin them onto the card's right border at each row.
const turnHandleStyle = {
  right: '-9px', top: '50%', transform: 'translate(50%, -50%)',
  width: '6px', height: '6px', minWidth: '0', minHeight: '0',
  border: 'none', background: 'transparent', opacity: 0, pointerEvents: 'none',
} as const
// The opener ("turn 0") sits in the header, which has no negative margin, so
// its anchor reaches the border from a bit further in.
const headHandleStyle = { ...turnHandleStyle, right: '-13px' } as const

// No more fork dropdown — clicking a turn (or the opener, via the summary)
// forks directly from that turn, same permission rule the old picker used.
function canFork(n: TreeNode) {
  return n.visibility === 'shared' || n.author_id === props.currentUserId
}
function tryFork(n: TreeNode) {
  if (!canFork(n)) return
  emit('fork', n.id)
}

// Press a turn's dot and drag across the canvas: a "thread" line follows the
// cursor (rendered by ReasoningTree.vue, which reads the shared drag state).
// The fork itself always targets this exact turn — wherever the pointer is
// released doesn't matter, dragging is purely a visual flourish on top of the
// same click-to-fork action.
const forkDrag = useForkDrag()
function onDotDown(n: TreeNode, ev: PointerEvent) {
  if (!canFork(n)) return
  ev.stopPropagation()
  forkDrag.start(ev.clientX, ev.clientY)
  const onMove = (e: PointerEvent) => forkDrag.move(e.clientX, e.clientY)
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    forkDrag.end()
    tryFork(n)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <div
    class="tnode"
    :class="{ sel: isSelected, forkpt: segment.head.is_fork_point }"
    @click="emit('select', tip.id)"
  >
    <!-- Invisible — kept only so vue-flow anchors edges left/right instead of
         falling back to top/bottom; the visible connector is now per-turn (.tdot). -->
    <Handle type="target" :position="Position.Left" class="cardhandle" />

    <div class="hdr">
      <div class="titlewrap" :class="{ forkable: canFork(starter) }" @click.stop="tryFork(starter)">
        <p class="ctitle" :class="{ ph: !title }" :title="title || fallback">
          <template v-if="title">{{ title }}</template>
          <span v-else-if="loading" class="shimmer">Summarizing…</span>
          <template v-else>{{ fallback }}</template>
        </p>
      </div>
      <UiBadge v-if="shortTag" class="idtag">{{ shortTag }}</UiBadge>
      <span v-if="showVisibility !== false" class="lockicon" :title="visTitle">
        <AppIcon :name="allShared ? 'unlock' : 'lock'" :size="14" />
      </span>
      <!-- Source anchor for the opener (turn 0), aligned to the header. -->
      <Handle :id="segment.head.id" type="source" :position="Position.Right" :style="headHandleStyle" />
    </div>

    <ol v-if="restNodes.length" class="turnlist">
      <li
        v-for="n in restNodes"
        :key="n.id"
        :class="{ forkable: canFork(n) }"
        :title="oneline(n.content, 200)"
        @click.stop="tryFork(n)"
      >
        <!-- Who said it: the agent, or the teammate who wrote the turn. -->
        <span v-if="n.role === 'assistant'" class="tavatar ai" title="Agent">AI</span>
        <UiAvatar
          v-else
          class="tavatar"
          :name="memberNames[n.author_id] ?? '?'"
          :color-key="n.author_id"
          :size="16"
        />
        <span class="tnum">{{ turnNumberOf(segment, n.id) }}</span>
        <span class="tsnippet">{{ oneline(n.content, 44) }}</span>
        <!-- Source anchor co-located with this turn's dot. -->
        <Handle :id="n.id" type="source" :position="Position.Right" :style="turnHandleStyle" />
        <span class="tdot nodrag" title="Fork from here" @pointerdown="onDotDown(n, $event)" @click.stop />
      </li>
    </ol>

    <div class="toolbar" @click.stop>
      <ReactionBar
        :reactions="segReactions"
        :current-user-id="currentUserId"
        :member-names="memberNames"
        @react="(t) => emit('react', { nodeId: segment.id, type: t })"
        @unreact="(p) => emit('unreact', p)"
      />
    </div>

    <div class="foot">
      <span class="fauthor">{{ authorName }}</span>
      <span class="ftime">{{ turnTime }}</span>
    </div>

    <!-- Default source anchor (card middle) — fallback for fork origins that
         aren't rendered as their own handle (turns past the row cap, or a
         parent re-parented past a hidden segment). -->
    <Handle id="card-src" type="source" :position="Position.Right" class="cardhandle" />
  </div>
</template>

<style scoped>
.tnode {
  position: relative;
  width: 300px;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
  padding: 12px 13px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(20, 20, 30, 0.06);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.tnode:hover { border-color: #d3cdf7; box-shadow: 0 6px 18px rgba(20, 20, 30, 0.1); }
.tnode.sel { box-shadow: 0 0 0 2px var(--accent); border-color: var(--accent); }

.hdr { position: relative; display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.idtag, .lockicon { margin-top: 2px; }
.lockicon { flex: none; display: flex; color: var(--muted); }
.idtag { flex: none; }

/* LLM-summarized headline is the card's one title — also "turn 0": click to
   fork from the opener, same as any other row below. */
.titlewrap {
  flex: 1;
  min-width: 0;
  margin: -2px -4px;
  padding: 2px 4px;
  border-radius: 8px;
  transition: background 0.12s ease;
}
.titlewrap.forkable { cursor: pointer; }
.titlewrap.forkable:hover { background: var(--accent-soft); }
.ctitle {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ctitle.ph { color: var(--muted); font-weight: 600; }
.shimmer {
  color: var(--muted);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.45; } }

/* No more single dot for the whole card — geometry only, not shown. */
.cardhandle { opacity: 0; pointer-events: none; }

/* The one visible connector per turn: a plain gray dot sitting right on the
   card's own border (not inline with the text), one per numbered row. */
.tdot {
  position: absolute;
  top: 50%;
  /* .tnode padding (13px) minus the row's own -4px negative margin (9px) —
     lands the dot's center exactly on the card's real border. */
  right: -9px;
  transform: translate(50%, -50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  box-shadow: 0 0 0 2px var(--card);
  transition: transform 0.12s ease;
}
.turnlist li.forkable:hover .tdot { transform: translate(50%, -50%) scale(1.6); }

.turnlist {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.turnlist li {
  position: relative; /* anchors this row's own .tdot — without it, every dot anchors to .tnode instead and they all stack at the card's center */
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 -4px;
  padding: 3px 4px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.35;
  transition: background 0.12s ease;
}
.turnlist li.forkable { cursor: pointer; }
.turnlist li.forkable:hover { background: var(--accent-soft); }
.turnlist li.forkable:hover .tsnippet { color: var(--accent); }
/* Per-turn author avatar: teammate initials (UiAvatar) or the agent's AI chip. */
.tavatar { flex: none; }
.tavatar.ai {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: var(--ink);
  color: var(--paper);
  font-size: 7.5px;
  font-weight: 700;
}
.tnum { flex: none; width: 12px; color: var(--accent); font-weight: 700; font-size: 9.5px; }
.tsnippet {
  flex: 1;
  min-width: 0;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s ease;
}

/* Reactions sit directly on top of the author/time footer, read as one block. */
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-size: 10.5px;
  color: var(--muted);
}
.fauthor { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ftime { flex: none; font-variant-numeric: tabular-nums; }
</style>
