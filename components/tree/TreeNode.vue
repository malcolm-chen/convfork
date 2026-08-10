<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { TreeNode, Reaction } from '~/composables/useConversation'
import { turnNumberOf, type Segment } from '~/composables/useSegments'
import type { ConceptTag } from '~/composables/useConcepts'
import { renderMarkdown } from '~/utils/markdown'

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
  // Merge mode: clicking the card toggles it into the merge selection
  // instead of selecting/forking — see pages/conversation/[id].vue.
  mergeMode?: boolean
  mergeSelected?: boolean
  // Canvas filter bar: when set, segments started by this author, or tagged
  // with this concept, get a highlighted border and everything else dims
  // (see CanvasFilterBar.vue).
  highlightAuthorId?: string | null
  concepts?: ConceptTag[]
  conceptsPending?: boolean
  highlightConceptId?: string | null
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'fork', id: string): void
  (e: 'react', payload: { nodeId: string; type: string }): void
  (e: 'unreact', payload: { id: string; nodeId: string; type: string }): void
  (e: 'toggle-merge-select', segmentId: string): void
  (e: 'request-concepts', payload: { segmentHeadNodeId: string; tipNodeId: string; model?: string | null }): void
}>()

const tip = computed(() => props.segment.tip)
const isSelected = computed(() => props.segment.nodes.some((n) => n.id === props.selectedId))

// The trajectory belongs to whoever started it (first user turn). A segment
// is always single-author (any reply from someone else always starts a new
// segment server-side, see chat.post.ts's isForkFromOther), so this is also
// a reliable "do I own this trajectory" check, not just a display label.
const starter = computed(
  () => props.segment.nodes.find((n) => n.role === 'user') ?? props.segment.head,
)
const authorName = computed(() => props.memberNames[starter.value.author_id] ?? 'Unknown')
const isOwnSegment = computed(() => starter.value.author_id === props.currentUserId)

const isConceptMatch = computed(
  () => !!props.highlightConceptId && (props.concepts ?? []).some((c) => c.id === props.highlightConceptId),
)
const isHighlighted = computed(
  () => (!!props.highlightAuthorId && starter.value.author_id === props.highlightAuthorId) || isConceptMatch.value,
)
const isDimmed = computed(
  () => (!!props.highlightAuthorId || !!props.highlightConceptId) && !isHighlighted.value,
)

const allShared = computed(() => props.segment.nodes.every((n) => n.visibility === 'shared'))
const anyShared = computed(() => props.segment.nodes.some((n) => n.visibility === 'shared'))
const visTitle = computed(() =>
  allShared.value ? 'shared' : anyShared.value ? 'partly shared' : 'private',
)

// Reactions anyone left anywhere on the trajectory; new ones attach to the
// segment's earliest SHARED node rather than the head, because the head can
// itself still be private (a segment renders as soon as ANY node in it is
// shared — see useSegments' isPublic check) — teammates who aren't its author
// never load a private node into their local tree, so a reaction attached to
// it would silently vanish from everyone else's view of the card. A fully
// shared segment (the common case) still resolves to the head, same as before.
const segReactions = computed(() =>
  props.segment.nodes.flatMap((n) => props.reactionsByNode.get(n.id) ?? []),
)
const reactionTargetId = computed(
  () => props.segment.nodes.find((n) => n.visibility === 'shared')?.id ?? props.segment.head.id,
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
// Whichever backbone this trajectory's most recent turn actually used — keeps
// the summary call on a provider the team has configured, instead of always
// reaching for a fixed default backbone regardless of what's selected.
const summaryModel = computed(
  () => [...props.segment.nodes].reverse().find((n) => n.model)?.model ?? null,
)
watch(transcript, (t) => summaries.request(t, summaryModel.value), { immediate: true })

// Ask the page to (re)tag this segment with concepts whenever its tip moves
// (new shared content) — mirrors the summary trigger above, but the actual
// shared-only transcript is derived server-side (see server/api/concepts/
// assign.post.ts), not from `transcript` here, which can include a
// not-yet-shared private turn (see useSegments.ts's sharedSegments()).
watch(
  () => tip.value.id,
  (tipId) => emit('request-concepts', { segmentHeadNodeId: props.segment.id, tipNodeId: tipId, model: summaryModel.value }),
  { immediate: true },
)

const title = computed(() => {
  const e = entry.value
  return e?.status === 'done' && e.text ? e.text : null
})

function oneline(text: string, len = 70) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean || '(empty)'
}

// "C1"/"C2"/… badge — the segment's position in the team's shared order.
// Never-shared segments show no badge (see useSegments.sharedOrder).
const shortTag = computed(() => (props.sharedIndex != null ? `C${props.sharedIndex}` : null))
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
const turnTime = computed(() => fmtTime(tip.value.created_at))

// Invisible vue-flow source anchors, one per node, co-located with that turn's
// dot so a fork edge connects to the exact turn it was forked from rather than
// the card's vertical middle. Inline styles (which beat vue-flow's own handle
// positioning classes) pin them onto the card's right border at each row.
const turnHandleStyle = {
  right: '-9px', top: '50%', transform: 'translate(50%, -50%)',
  width: '6px', height: '6px', minWidth: '0', minHeight: '0',
  border: 'none', background: 'transparent', opacity: 0, pointerEvents: 'none',
} as const

// No more fork dropdown — clicking a turn (or the opener, via the summary)
// forks directly from that turn, same permission rule the old picker used.
function canFork(n: TreeNode) {
  return n.visibility === 'shared' || n.author_id === props.currentUserId
}
function tryFork(n: TreeNode) {
  if (props.mergeMode || !canFork(n)) return
  emit('fork', n.id)
}

function onCardClick() {
  if (props.mergeMode) {
    emit('toggle-merge-select', props.segment.id)
    return
  }
  // Your own trajectory opens straight into the chat panel to continue it.
  // A teammate's is never pulled into the chat panel just by looking at it —
  // that would make their content read as an active conversation you're
  // already in, when it's actually still theirs. Route the same way a turn
  // click already does: through the fork-confirmation flow, so continuing
  // it is an explicit choice that creates your own branch.
  if (isOwnSegment.value) emit('select', tip.value.id)
  else emit('fork', tip.value.id)
}

// Turn rows normally stop propagation (a row click forks that exact turn,
// distinct from selecting the whole card) — but merge mode has no per-turn
// action, so route it to the same toggle the card click would emit instead
// of just swallowing the click.
function onTurnClick(n: TreeNode) {
  if (props.mergeMode) {
    emit('toggle-merge-select', props.segment.id)
    return
  }
  tryFork(n)
}

// Press a turn's dot and drag across the canvas: a "thread" line follows the
// cursor (rendered by ReasoningTree.vue, which reads the shared drag state).
// The fork itself always targets this exact turn — wherever the pointer is
// released doesn't matter, dragging is purely a visual flourish on top of the
// same click-to-fork action.
const forkDrag = useForkDrag()
function onDotDown(n: TreeNode, ev: PointerEvent) {
  if (props.mergeMode || !canFork(n)) return
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
    :class="{ sel: isSelected, forkpt: segment.head.is_fork_point, mergeable: mergeMode, mergeselected: mergeSelected, highlight: isHighlighted, dimmed: isDimmed }"
    @click="onCardClick"
  >
    <span v-if="mergeMode" class="mergemark" :class="{ on: mergeSelected }">
      <AppIcon v-if="mergeSelected" name="check" :size="11" />
    </span>
    <!-- Invisible — kept only so vue-flow anchors edges left/right instead of
         falling back to top/bottom; the visible connector is now per-turn (.tdot). -->
    <Handle type="target" :position="Position.Left" class="cardhandle" />

    <div class="hdr">
      <div class="titlewrap">
        <p class="ctitle" :class="{ ph: !title }">
          <template v-if="title">{{ title }}</template>
          <span v-else-if="entry?.status === 'error'">Untitled branch</span>
          <span v-else class="shimmer">Summarizing…</span>
        </p>
      </div>
      <UiBadge v-if="shortTag" class="idtag">{{ shortTag }}</UiBadge>
      <span v-if="showVisibility !== false" class="lockicon" :title="visTitle">
        <AppIcon :name="allShared ? 'unlock' : 'lock'" :size="14" />
      </span>
    </div>

    <div v-if="conceptsPending && !concepts?.length" class="conceptloading" title="Tagging topics…" />
    <ul v-else-if="concepts?.length" class="concepttags">
      <li
        v-for="c in concepts"
        :key="c.id"
        class="concepttag"
        :class="{ on: c.id === highlightConceptId }"
        :style="c.id === highlightConceptId ? undefined : tagColors(c.id)"
        :title="c.description"
      >
        {{ c.name }}
      </li>
    </ul>

    <ol class="turnlist">
      <li
        v-for="n in segment.nodes"
        :key="n.id"
        :class="{ forkable: canFork(n) && !mergeMode }"
        @click.stop="onTurnClick(n)"
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
        <div class="turntip nodrag nowheel" role="tooltip">
          <div class="turntipcard">
            <ClientOnly v-if="n.role === 'assistant'">
              <div class="md" v-html="renderMarkdown(n.content)" />
              <template #fallback>{{ n.content }}</template>
            </ClientOnly>
            <template v-else>{{ n.content }}</template>
          </div>
        </div>
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
        @react="(t) => emit('react', { nodeId: reactionTargetId, type: t })"
        @unreact="(p) => emit('unreact', p)"
      />
    </div>

    <div class="foot">
      <div class="fauthor">
        <UiAvatar class="favatar" :name="authorName" :color-key="starter.author_id" :size="18" />
        <span class="flabel">Shared by <strong>{{ authorName }}</strong></span>
      </div>
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
  transition: box-shadow 0.15s ease, border-color 0.15s ease, padding 0.1s ease, opacity 0.15s ease;
}
.tnode:hover { border-color: #d3cdf7; box-shadow: 0 6px 18px rgba(20, 20, 30, 0.1); }
.tnode.sel { box-shadow: 0 0 0 2px var(--accent); border-color: var(--accent); }
.tnode.mergeselected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.tnode.highlight { border-color: var(--highlight); box-shadow: 0 0 0 2px var(--highlight); }
.tnode.dimmed { opacity: 0.4; }
/* The merge-select mark is an absolutely positioned badge, not part of the
   normal flow, so it sits on top of whatever's in that corner regardless of
   how much room the content itself has — the card needs extra top/left
   padding while it's showing, or it just overlaps the title. */
.tnode.mergeable { padding-top: 34px; padding-left: 32px; }
.mergemark {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  background: var(--card);
  color: #fff;
}
.mergemark.on { background: var(--accent); border-color: var(--accent); }

.hdr { position: relative; display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.idtag, .lockicon { margin-top: 2px; }
.lockicon { flex: none; display: flex; color: var(--muted); }
.idtag { flex: none; }

/* Concept chips — each tag gets a stable color hashed from its id (see
   utils/tagColor.ts), outlined rather than filled so the chip style never
   reads as a teammate's (filled, circular) avatar. */
.concepttags {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: -2px 0 8px;
  padding: 0;
}
.concepttag {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}
.concepttag.on { background: var(--highlight); border-color: var(--highlight); color: #fff; }

/* Shown in place of the chip row while a segment's concepts are still being
   generated — a sweeping gradient, not the title's plain opacity pulse, so
   it reads distinctly as "loading a list" rather than "loading text". */
.conceptloading {
  height: 14px;
  width: 65%;
  border-radius: 999px;
  margin: -2px 0 8px;
  background: linear-gradient(90deg, var(--line) 25%, #d8d8de 37%, var(--line) 63%);
  background-size: 400% 100%;
  animation: concept-shimmer 1.4s ease-in-out infinite;
}
@keyframes concept-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* LLM-summarized headline — the card's one title, always the summary (never
   raw turn text; turn 1 is just another row in the list below like any other
   turn, with its own hover popover — the title itself doesn't show one). */
.titlewrap {
  flex: 1;
  min-width: 0;
  margin: -2px -4px;
  padding: 2px 4px;
  border-radius: 8px;
}
.ctitle {
  margin: 0;
  font-family: 'Geist', sans-serif;
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

/* Full-message hover popover for a numbered row — truncated in the compact
   turn list, so hovering reveals the whole thing instead of relying on a
   plain browser tooltip.
   .turntip itself is an invisible hit-box, not the visible card — it carries
   the gap to the card as padding (not a positional offset) plus generous
   slack on every side, so the whole path from the row to the card is one
   continuous hoverable region. A positional gap here was the bug: the
   instant the cursor drifted a couple of pixels off that empty strip, the
   :hover match broke and the popover vanished before the cursor ever reached
   it. */
.turntip {
  display: none;
  position: absolute;
  z-index: 50;
  top: 50%;
  left: 100%;
  transform: translateY(-50%);
  padding: 28px 24px 28px 10px;
}
.turntipcard {
  width: 260px;
  max-height: 220px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  box-shadow: 0 10px 28px rgba(20, 20, 30, 0.18);
  color: var(--ink);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.55;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: auto;
}
/* Markdown typography for assistant turns (mirrors ThreadPanel.vue's .body.md) —
   v-html content isn't scoped, so it must be reached with :deep(). */
.turntipcard .md { white-space: normal; }
.turntipcard .md :deep(> *:first-child) { margin-top: 0; }
.turntipcard .md :deep(> *:last-child) { margin-bottom: 0; }
.turntipcard .md :deep(p) { margin: 0 0 0.6em; }
.turntipcard .md :deep(h1),
.turntipcard .md :deep(h2),
.turntipcard .md :deep(h3),
.turntipcard .md :deep(h4) { margin: 0.8em 0 0.4em; line-height: 1.3; font-weight: 600; }
.turntipcard .md :deep(ul),
.turntipcard .md :deep(ol) { margin: 0 0 0.6em; padding-left: 1.3em; }
.turntipcard .md :deep(li) { margin: 0.15em 0; }
.turntipcard .md :deep(a) { color: var(--accent); text-decoration: underline; }
.turntipcard .md :deep(strong) { font-weight: 600; }
.turntipcard .md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: rgba(0, 0, 0, 0.06);
  padding: 0.1em 0.32em;
  border-radius: 5px;
}
.turntipcard .md :deep(pre) {
  margin: 0 0 0.6em;
  padding: 9px 11px;
  background: #1e1e24;
  color: #f1efe9;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 11.5px;
  line-height: 1.5;
}
.turntipcard .md :deep(pre code) { background: none; padding: 0; font-size: inherit; color: inherit; }
.turntipcard .md :deep(blockquote) {
  margin: 0 0 0.6em;
  padding: 0.1em 0 0.1em 0.8em;
  border-left: 3px solid var(--line);
  color: var(--muted);
}
.turntipcard .md :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 0.8em 0; }
.turnlist li:hover .turntip {
  display: block;
}

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
.fauthor { display: flex; align-items: center; gap: 6px; min-width: 0; }
.favatar { flex: none; }
.flabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flabel strong { font-weight: 700; color: var(--ink); }
.ftime { flex: none; font-variant-numeric: tabular-nums; }
</style>
