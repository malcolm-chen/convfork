<script setup lang="ts">
import { VueFlow, useVueFlow, useNodesInitialized } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import dagre from 'dagre'
import NodeCard from '~/components/tree/TreeNode.vue'
import { segmentize, sharedOrder, sharedSegments, type Segment } from '~/composables/useSegments'
import type { TreeNode, Reaction } from '~/composables/useConversation'

const props = defineProps<{
  nodes: TreeNode[]
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
  (e: 'toggle-visibility', nodes: TreeNode[]): void
}>()

// Recomputed synchronously (no debounce) straight off props.nodes, so a card's
// turn list / fork options never lag behind an in-flight chat. Cards look
// themselves up here by their stable segment id rather than trusting the
// (debounced, and separately vue-flow-internal) node.data below.
const allSegments = computed(() => segmentize(props.nodes))

// The canvas only shows what's actually been shared with the team — a segment
// with no shared node at all is private draft work and stays out of the
// shared view entirely (still reachable via Chat History). A private segment
// in the middle of a chain is skipped rather than orphaning its descendants:
// they re-parent to the nearest ancestor segment that IS visible.
const segments = computed(() => sharedSegments(allSegments.value))
const segmentsById = computed(() => new Map(segments.value.map((s) => [s.id, s])))
// C1/C2/… badges, numbered by when each segment was first shared (not created).
const sharedIndexById = computed(() => sharedOrder(segments.value))

// Press-and-drag "thread" effect from a turn's dot (TreeNode.vue starts/
// updates it; this just renders the live line following the cursor).
const forkDrag = useForkDrag()
const threadPath = computed(() => {
  const { originX, originY, pointerX, pointerY } = forkDrag.state
  const midX = originX + (pointerX - originX) / 2
  return `M ${originX} ${originY} C ${midX} ${originY}, ${midX} ${pointerY}, ${pointerX} ${pointerY}`
})

const vfNodes = ref<any[]>([])
const vfEdges = ref<any[]>([])
let timer: ReturnType<typeof setTimeout> | null = null

const { fitView, viewport } = useVueFlow()
let knownSegIds = new Set<string>()
let hasSeenSegments = false

// `fitView()` needs every card's real measured width/height or it computes a
// zero-size bounding box (NaN/Infinity zoom, shown as "NaN%" in CanvasControls).
// Dimensions are measured via ResizeObserver — async, not guaranteed to be
// done by the next Vue tick — so wait for vue-flow's own readiness signal
// instead of guessing with nextTick()/setTimeout(). That signal only covers
// node measurement though, not the pane's own size (e.g. still 0 while a
// split-panel drag is mid-layout) — if the fit still comes out non-finite,
// don't latch fittedOnce; let the next nodesInitialized toggle retry.
const nodesInitialized = useNodesInitialized()
let fittedOnce = false
watch(nodesInitialized, async (ready) => {
  if (ready && !fittedOnce) {
    await fitView()
    if (Number.isFinite(viewport.zoom)) fittedOnce = true
  }
})

const W = 300

// Estimate card height for dagre. Base layout (header + 2-line summary +
// action toolbar + author/timestamp footer) is constant; each turn past the
// opener adds its own avatar row (TreeNode.vue's turn list, now uncapped) so
// the estimate must grow with the full turn count to avoid overlap.
const ROW_H = 22
function segHeight(s: Segment<TreeNode>) {
  const restCount = Math.max(0, s.nodes.length - 1)
  if (!restCount) return 148
  return 148 + 8 + restCount * ROW_H
}

// Layout (dagre positions) is expensive, so it stays debounced — but that
// only affects where a card sits, never what it shows (see segments above).
function relayout() {
  const segs = segments.value

  // Segments that weren't around last layout get a one-time "thread" draw-in
  // animation on their incoming edge — but not on the very first layout ever,
  // where everything is "new" and nothing should animate.
  const currentIds = new Set(segs.map((s) => s.id))
  const newIds = hasSeenSegments
    ? new Set([...currentIds].filter((id) => !knownSegIds.has(id)))
    : new Set<string>()
  knownSegIds = currentIds
  hasSeenSegments = true

  const g = new dagre.graphlib.Graph()
  // Left-to-right cascade (rather than top-down) to match the reference layout.
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const s of segs) g.setNode(s.id, { width: W, height: segHeight(s) })
  for (const s of segs) if (s.parentId) g.setEdge(s.parentId, s.id)
  dagre.layout(g)
  vfNodes.value = segs.map((s) => {
    const p = g.node(s.id)
    return { id: s.id, type: 'msg', position: { x: p.x - W / 2, y: p.y - segHeight(s) / 2 }, data: s }
  })
  const segById = new Map(segs.map((s) => [s.id, s]))
  vfEdges.value = segs
    .filter((s) => s.parentId)
    .map((s) => {
      // Anchor the edge to the exact turn it was forked from (the child head's
      // parent node). Every turn now renders its own handle, so any origin
      // within the parent segment resolves; a parent re-parented past a hidden
      // segment (origin not in it) falls back to the card's default handle.
      const parent = segById.get(s.parentId as string)
      const originInParent = parent?.nodes.some((n) => n.id === s.head.parent_id)
      const sourceHandle = originInParent ? (s.head.parent_id as string) : 'card-src'
      return {
        id: `${s.parentId}->${s.id}`,
        source: s.parentId as string,
        sourceHandle,
        target: s.id,
        animated: false,
        class: newIds.has(s.id) ? 'edge-draw' : undefined,
        style: { stroke: '#b7b7c0', strokeWidth: 1.8 },
      }
    })
}

// Recompute layout when the node set or visibility changes (debounced ~150ms).
watch(
  () => props.nodes.map((n) => n.id + n.visibility).join(','),
  () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(relayout, 150)
  },
  { immediate: true },
)
</script>

<template>
  <div class="treewrap">
    <VueFlow
      :nodes="vfNodes"
      :edges="vfEdges"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      :min-zoom="0.2"
      :max-zoom="1.5"
    >
      <template #node-msg="{ data }">
        <NodeCard
          :segment="segmentsById.get(data.id) ?? data"
          :shared-index="sharedIndexById.get(data.id) ?? null"
          :reactions-by-node="reactionsByNode"
          :selected-id="selectedId"
          :current-user-id="currentUserId"
          :member-names="memberNames"
          :show-visibility="showVisibility !== false"
          @select="(id) => emit('select', id)"
          @fork="(id) => emit('fork', id)"
          @react="(p) => emit('react', p)"
          @unreact="(p) => emit('unreact', p)"
          @toggle-visibility="(ns) => emit('toggle-visibility', ns)"
        />
      </template>
      <Background pattern-color="#e3e3ea" :gap="22" />
      <CanvasControls />
    </VueFlow>

    <svg v-if="forkDrag.state.active" class="threadoverlay">
      <path :d="threadPath" class="threadline" />
    </svg>
  </div>
</template>

<style scoped>
.treewrap { height: 100%; width: 100%; }

/* One-time "thread" draw-in for a newly forked branch's connecting edge. */
:deep(.edge-draw .vue-flow__edge-path) {
  stroke-dasharray: 700;
  stroke-dashoffset: 700;
  animation: thread-draw 0.7s ease-out forwards;
}
@keyframes thread-draw {
  to { stroke-dashoffset: 0; }
}

/* Live "thread" preview while dragging from a turn's dot — drawn in screen
   space (fixed + raw client coordinates), so no canvas pan/zoom transform to
   account for. */
.threadoverlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}
.threadline {
  fill: none;
  stroke: var(--ink);
  stroke-width: 1.6;
  stroke-linecap: round;
}
</style>
