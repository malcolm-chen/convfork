<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { TreeNode, Reaction } from '~/composables/useConversation'
import { turnNumberOf, type Segment } from '~/composables/useSegments'
import type { ConceptTag } from '~/composables/useConcepts'
import type { PresenceMeta } from '~/composables/useRealtime'
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
  /** Teammates currently chatting on this segment (rendered by PresenceStack.vue). */
  presence?: PresenceMeta[]
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
  // Fired when the user starts/stops actually viewing this card's content
  // (hovering a turn's full-content preview below) — drives the teammate
  // presence indicator, see usePresenceActivity.ts. Always carries this
  // card's own segment id, even on the "stopped" edge (tied to the same
  // debounce as the popover itself) — the listener needs that to tell a
  // genuine "I stopped" from a stale, delayed one that arrives after the
  // user has already moved on to hovering a different card (see
  // usePresenceActivity's onViewSegment for why that distinction matters).
  (e: 'view-segment', payload: { segmentId: string; viewing: boolean }): void
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

// The turn list only ever shows turns actually shared with the team — a
// partly-shared segment's still-private turns must never render here, even
// to the segment's own author. turnNumberOf() below is still called against
// the full segment (not this filtered list), so a shown turn keeps its true
// original position (e.g. "8") instead of being renumbered among just the
// visible ones.
const visibleNodes = computed(() => props.segment.nodes.filter((n) => n.visibility === 'shared'))

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

// Who's pinned this card — same 📌 reaction ReactionBar.vue's quick-pin
// button toggles (kept as a plain reaction so it stays in sync automatically
// via the same realtime/reaction machinery, rather than a separate field).
// Surfaced here as a top-left badge + tinted background so a pinned branch is
// obvious at a glance on the canvas, not just inside the reaction bar.
const PIN_EMOJI = '📌'
const pinnedBy = computed(() => {
  const seen = new Set<string>()
  const list: { userId: string; name: string }[] = []
  for (const r of segReactions.value) {
    if (r.type !== PIN_EMOJI || seen.has(r.user_id)) continue
    seen.add(r.user_id)
    list.push({ userId: r.user_id, name: r.user_id === props.currentUserId ? 'You' : (props.memberNames[r.user_id] ?? 'Someone') })
  }
  // "You" first, matching ReactionBar's own pin-tip ordering.
  return list.sort((a, b) => (a.name === 'You' ? -1 : b.name === 'You' ? 1 : 0))
})
const isPinned = computed(() => pinnedBy.value.length > 0)
// "You pinned this node" / "Ada pinned this node" / "You and Sam pinned this
// node" / "Ada and 2 others pinned this node".
const pinTooltip = computed(() => {
  const names = pinnedBy.value.map((p) => p.name)
  if (!names.length) return ''
  if (names.length === 1) return names[0] === 'You' ? 'You pinned this node' : `${names[0]} pinned this node`
  if (names.length === 2) return `${names[0]} and ${names[1]} pinned this node`
  return `${names[0]} and ${names.length - 1} others pinned this node`
})

// ── Auto-summary (ChatGPT-sidebar style) instead of raw turns ──
const summaries = useNodeSummaries()
const { rename } = useNodeTitle()
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
// A human's manual rename (segment.head.title_manual, synced from the DB —
// see server/api/nodes/rename.post.ts) always wins: never re-summarize over
// it. Otherwise only ask the model again once the segment has actually grown
// past whatever content its current title (if any) was generated from.
watch(
  transcript,
  (t) => {
    if (props.segment.head.title_manual) return
    const key = summaries.keyFor(t)
    if (props.segment.head.title && props.segment.head.title_hash === key) return
    summaries.request(t, summaryModel.value)
  },
  { immediate: true },
)
// Persist a freshly-generated auto title so every teammate's canvas — not
// just the browser that happened to trigger the LLM call — shows it.
// `segment.head` is the same reactive object useConversation.ts keeps in its
// nodesById map (segmentize() only groups references, never clones), so
// mutating it here shows the new title immediately instead of waiting on the
// realtime UPDATE round trip — which the eventual UPDATE then just confirms.
watch(entry, (e) => {
  if (props.segment.head.title_manual || !e || e.status !== 'done' || !e.text) return
  if (e.text === props.segment.head.title && sumKey.value === props.segment.head.title_hash) return
  props.segment.head.title = e.text
  props.segment.head.title_hash = sumKey.value
  rename(props.segment.head.id, e.text, false, sumKey.value)
})

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
  if (props.segment.head.title) return props.segment.head.title
  const e = entry.value
  return e?.status === 'done' && e.text ? e.text : null
})

// Inline rename of the card's title — a manual override (useNodeTitle.ts),
// synced to every team member the same way the auto-summary is.
const editingTitle = ref(false)
const titleDraft = ref('')
let titleInputEl: HTMLInputElement | null = null
function setTitleInputEl(el: unknown) {
  titleInputEl = el as HTMLInputElement | null
}
function startEditTitle() {
  editingTitle.value = true
  titleDraft.value = title.value ?? ''
  nextTick(() => {
    titleInputEl?.focus()
    titleInputEl?.select()
  })
}
function cancelEditTitle() {
  editingTitle.value = false
}
function submitEditTitle() {
  if (!editingTitle.value) return // already handled (Enter, then the input's blur on unmount)
  const t = titleDraft.value.trim()
  editingTitle.value = false
  if (!t || t === title.value) return
  // Optimistic — see the identical note on the auto-summary persist watcher
  // above for why mutating segment.head directly is safe here.
  props.segment.head.title = t
  props.segment.head.title_manual = true
  rename(props.segment.head.id, t, true)
}

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

// Full-message hover popover, teleported to <body> (see template) so it
// always paints above every node on the canvas — vue-flow gives each
// `.vue-flow__node` its own stacking context, so a z-index set from inside
// one node can never beat a sibling node's box, only escaping the node's DOM
// subtree entirely fixes that. Position is therefore computed in JS from the
// hovered row's own screen rect instead of via CSS adjacency (`:hover +`),
// and hide is debounced so the cursor can cross the gap from the row to the
// popover without it vanishing mid-travel.
const hoverTurn = ref<TreeNode | null>(null)
const tipPos = reactive({ top: 0, left: 0 })
const tipEl = ref<HTMLElement | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearHideTimer() {
  if (hideTimer != null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}
// Presence is a live "am I looking at this right now" signal, not the same
// thing as the tooltip's own visual debounce below (which only exists so the
// cursor can cross the gap from row to popover without a flicker) — viewing
// is fundamentally more ephemeral than composing/streaming, so it must clear
// the instant the mouse actually leaves, with no lingering/fade of its own.
function clearViewPresence() {
  emit('view-segment', { segmentId: props.segment.id, viewing: false })
}
function scheduleHideTip() {
  clearViewPresence()
  clearHideTimer()
  hideTimer = setTimeout(() => { hoverTurn.value = null }, 150)
}
const TIP_WIDTH = 340
function showTip(n: TreeNode, ev: MouseEvent) {
  clearHideTimer()
  hoverTurn.value = n
  emit('view-segment', { segmentId: props.segment.id, viewing: true })
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const gap = 14
  const fitsRight = rect.right + gap + TIP_WIDTH <= window.innerWidth - 12
  tipPos.left = fitsRight ? rect.right + gap : Math.max(12, rect.left - gap - TIP_WIDTH)
  const centerY = rect.top + rect.height / 2
  tipPos.top = centerY
  nextTick(() => {
    const el = tipEl.value
    if (!el || hoverTurn.value !== n) return
    const h = el.offsetHeight
    const maxTop = Math.max(12, window.innerHeight - h - 12)
    tipPos.top = Math.min(Math.max(centerY - h / 2, 12), maxTop)
  })
}
// Cursor moved from the row into the popover itself — the tooltip's own
// hide is already cancelled (see below), but presence needs re-affirming too,
// since it was just cleared immediately on the row's mouseleave above.
function onEnterTip() {
  clearHideTimer()
  emit('view-segment', { segmentId: props.segment.id, viewing: true })
}
// If this card unmounts (segment re-parented away, unshared, etc.) while
// being actively hovered, clear the hover-driven presence signal rather than
// leaving it pointed at a card that no longer exists.
onBeforeUnmount(() => {
  clearHideTimer()
  if (hoverTurn.value) clearViewPresence()
})

// Same hand-rolled hover-tooltip pattern PresenceStack.vue uses, just anchored
// below the badge instead of above it (the pin badge already sits right at
// the card's top edge, so there's no room to place a tip above it).
const pinTipVisible = ref(false)
const pinTipPos = reactive({ top: 0, left: 0 })
let pinHideTimer: ReturnType<typeof setTimeout> | null = null
function clearPinHideTimer() {
  if (pinHideTimer != null) {
    clearTimeout(pinHideTimer)
    pinHideTimer = null
  }
}
function schedulePinHide() {
  clearPinHideTimer()
  pinHideTimer = setTimeout(() => { pinTipVisible.value = false }, 150)
}
function showPinTip(ev: MouseEvent) {
  clearPinHideTimer()
  pinTipVisible.value = true
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const TIP_WIDTH = 220
  pinTipPos.left = Math.min(rect.left, window.innerWidth - TIP_WIDTH - 12)
  pinTipPos.top = rect.bottom + 8
}
</script>

<template>
  <div
    class="tnode"
    :class="{ sel: isSelected, forkpt: segment.head.is_fork_point, mergeable: mergeMode, mergeselected: mergeSelected, highlight: isHighlighted, dimmed: isDimmed, pinned: isPinned }"
    @click="onCardClick"
  >
    <span v-if="mergeMode" class="mergemark" :class="{ on: mergeSelected }">
      <AppIcon v-if="mergeSelected" name="check" :size="11" />
    </span>
    <!-- Pinned indicator: skipped in merge mode since it shares the same
         top-left corner as the merge-select mark above. -->
    <span
      v-if="isPinned && !mergeMode"
      class="pinbadge"
      @click.stop
      @mouseenter="showPinTip"
      @mouseleave="schedulePinHide"
    >
      <AppIcon name="thumbtack" :size="11" />
    </span>
    <!-- Invisible — kept only so vue-flow anchors edges left/right instead of
         falling back to top/bottom; the visible connector is now per-turn (.tdot). -->
    <Handle type="target" :position="Position.Left" class="cardhandle" />

    <div class="hdr">
      <div class="titlewrap">
        <input
          v-if="editingTitle"
          :ref="setTitleInputEl"
          v-model="titleDraft"
          class="ctitleinput nodrag"
          maxlength="80"
          @click.stop
          @pointerdown.stop
          @keydown.enter.exact.stop.prevent="submitEditTitle"
          @keyup.esc.stop="cancelEditTitle"
          @blur="submitEditTitle"
        />
        <template v-else>
          <p class="ctitle" :class="{ ph: !title }">
            <template v-if="title">{{ title }}</template>
            <span v-else-if="entry?.status === 'error'">Untitled branch</span>
            <span v-else class="shimmer">Summarizing…</span>
          </p>
          <button
            v-if="!mergeMode"
            type="button"
            class="titleeditbtn nodrag"
            title="Rename"
            @click.stop="startEditTitle"
            @pointerdown.stop
          >
            <AppIcon name="pencil" :size="11" />
          </button>
        </template>
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
        v-for="n in visibleNodes"
        :key="n.id"
        :class="{ forkable: canFork(n) && !mergeMode }"
        @click.stop="onTurnClick(n)"
        @mouseenter="showTip(n, $event)"
        @mouseleave="scheduleHideTip"
        @wheel="scheduleHideTip"
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

    <!-- Teammate presence: who's chatting on this segment right now. Never
         shown for a segment that isn't shared — there's nothing to leak,
         since a private segment never even reaches this component (see
         useSegments.sharedSegments) and usePresenceActivity never tracks one. -->
    <PresenceStack :presence="presence" :member-names="memberNames" :current-user-id="currentUserId" />
  </div>

  <!-- Teleported to <body> so this always paints above every canvas node,
       instead of being trapped inside this node's own vue-flow stacking
       context (see showTip() above). -->
  <Teleport to="body">
    <div
      v-if="hoverTurn"
      ref="tipEl"
      class="turntip-portal"
      role="tooltip"
      :style="{ top: tipPos.top + 'px', left: tipPos.left + 'px' }"
      @mouseenter="onEnterTip"
      @mouseleave="scheduleHideTip"
    >
      <div class="turntiphdr">
        <span v-if="hoverTurn.role === 'assistant'" class="tavatar ai" title="Agent">AI</span>
        <UiAvatar
          v-else
          class="tavatar"
          :name="memberNames[hoverTurn.author_id] ?? '?'"
          :color-key="hoverTurn.author_id"
          :size="16"
        />
        <span class="turntiplabel">
          {{ hoverTurn.role === 'assistant' ? 'Agent' : memberNames[hoverTurn.author_id] ?? 'Unknown' }}
          (Turn {{ turnNumberOf(segment, hoverTurn.id) }})
        </span>
      </div>
      <ClientOnly v-if="hoverTurn.role === 'assistant'">
        <div class="md" v-html="renderMarkdown(hoverTurn.content)" />
        <template #fallback>{{ hoverTurn.content }}</template>
      </ClientOnly>
      <template v-else>{{ hoverTurn.content }}</template>
    </div>
  </Teleport>

  <!-- Teleported for the same reason as the turn popover above: escapes this
       node's own vue-flow stacking context so it always paints on top. -->
  <Teleport to="body">
    <div
      v-if="pinTipVisible"
      class="pin-tip-portal"
      role="tooltip"
      :style="{ top: pinTipPos.top + 'px', left: pinTipPos.left + 'px' }"
      @mouseenter="clearPinHideTimer"
      @mouseleave="schedulePinHide"
    >
      {{ pinTooltip }}
    </div>
  </Teleport>
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
/* Pinned: a warm sticky-note tint on the whole card, distinct from the
   border/box-shadow language used by selection/highlight above — so a pinned
   branch reads as a persistent label rather than a momentary interaction
   state, and still shows clearly through those states if both apply. */
.tnode.pinned { background: #fef6e3; }
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

/* Pinned badge — peeks off the card's top-left corner, mirroring how the
   presence stack peeks off the bottom-right, so the two "someone did
   something to this card" affordances read as one visual family. */
.pinbadge {
  position: absolute;
  top: -8px;
  left: -8px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--highlight);
  color: #fff;
  box-shadow: 0 0 0 2px var(--card);
  cursor: default;
}

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
  display: flex;
  align-items: flex-start;
  gap: 4px;
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
.titleeditbtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--muted);
  opacity: 0;
  cursor: pointer;
}
.tnode:hover .titleeditbtn { opacity: 1; }
.titleeditbtn:hover { background: var(--accent-soft); color: var(--ink); }
.ctitleinput {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
  border-bottom: 1.5px solid var(--accent);
  background: none;
  font-family: 'Geist', sans-serif;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ink);
}
.ctitleinput:focus { outline: none; }
.shimmer {
  color: var(--muted);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.45; } }

/* Full-message hover popover for a numbered row — truncated in the compact
   turn list, so hovering reveals the whole thing instead of relying on a
   plain browser tooltip.
   Teleported to <body> (see the template's <Teleport> block) and positioned
   in JS from the hovered row's screen rect: every vue-flow node is its own
   stacking context, so a z-index set here would only ever win against its
   own card's children, never against a sibling node's box. Escaping the
   node's DOM subtree entirely is the only way to guarantee this always
   paints above the canvas. Hiding is debounced from JS (showTip/scheduleHideTip)
   instead of relying on CSS `:hover` adjacency, since the popover is no
   longer a DOM sibling of the row that triggers it. */
.turntip-portal {
  position: fixed;
  z-index: 150;
  width: 340px;
  max-height: 340px;
  overflow-y: auto;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
  box-shadow: 0 16px 40px rgba(20, 20, 30, 0.24);
  color: var(--ink);
  font-size: 13.5px;
  font-weight: 400;
  line-height: 1.6;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: auto;
}
.turntiphdr {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -2px 0 9px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.turntiplabel {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
/* Markdown typography for assistant turns (mirrors ThreadPanel.vue's .body.md) —
   v-html content isn't scoped, so it must be reached with :deep(). */
.turntip-portal .md { white-space: normal; }
.turntip-portal .md :deep(> *:first-child) { margin-top: 0; }
.turntip-portal .md :deep(> *:last-child) { margin-bottom: 0; }
.turntip-portal .md :deep(p) { margin: 0 0 0.6em; }
.turntip-portal .md :deep(h1),
.turntip-portal .md :deep(h2),
.turntip-portal .md :deep(h3),
.turntip-portal .md :deep(h4) { margin: 0.8em 0 0.4em; line-height: 1.3; font-weight: 600; }
.turntip-portal .md :deep(ul),
.turntip-portal .md :deep(ol) { margin: 0 0 0.6em; padding-left: 1.3em; }
.turntip-portal .md :deep(li) { margin: 0.15em 0; }
.turntip-portal .md :deep(a) { color: var(--accent); text-decoration: underline; }
.turntip-portal .md :deep(strong) { font-weight: 600; }
.turntip-portal .md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: rgba(0, 0, 0, 0.06);
  padding: 0.1em 0.32em;
  border-radius: 5px;
}
.turntip-portal .md :deep(pre) {
  margin: 0 0 0.6em;
  padding: 9px 11px;
  background: #1e1e24;
  color: #f1efe9;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}
.turntip-portal .md :deep(pre code) { background: none; padding: 0; font-size: inherit; color: inherit; }
.turntip-portal .md :deep(blockquote) {
  margin: 0 0 0.6em;
  padding: 0.1em 0 0.1em 0.8em;
  border-left: 3px solid var(--line);
  color: var(--muted);
}
.turntip-portal .md :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 0.8em 0; }

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

/* The pin badge sits at the card's top edge, so its tip hangs below the
   anchor — same hand-rolled hover-tooltip box as PresenceStack.vue's, just
   without the upward translateY (there's no room above the badge). */
.pin-tip-portal {
  position: fixed;
  z-index: 150;
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
