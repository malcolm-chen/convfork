<script setup lang="ts">
import { VueFlow, useVueFlow, useNodesInitialized } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import dagre from 'dagre'
import NodeCard from '~/components/tree/TreeNode.vue'
import MergedNodeCard from '~/components/tree/MergedNodeCard.vue'
import { segmentize, sharedOrder, sharedSegments, type Segment } from '~/composables/useSegments'
import type { TreeNode, Reaction } from '~/composables/useConversation'
import type { MergedNode } from '~/composables/useMergedNodes'
import type { ConceptTag } from '~/composables/useConcepts'

const props = defineProps<{
  nodes: TreeNode[]
  reactionsByNode: Map<string, Reaction[]>
  selectedId: string | null
  currentUserId: string
  memberNames: Record<string, string>
  showVisibility?: boolean
  mergedNodes?: MergedNode[]
  mergeMode?: boolean
  mergeSelectedIds?: Set<string>
  highlightAuthorId?: string | null
  conceptsBySegment?: Map<string, ConceptTag[]>
  conceptsPending?: Set<string>
  highlightConceptId?: string | null
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'fork', id: string): void
  (e: 'react', payload: { nodeId: string; type: string }): void
  (e: 'unreact', payload: { id: string; nodeId: string; type: string }): void
  (e: 'toggle-visibility', nodes: TreeNode[]): void
  (e: 'toggle-merge-select', segmentId: string): void
  (e: 'fork-merge', mergedNodeId: string): void
  (e: 'delete-merge', mergedNodeId: string): void
  (e: 'request-concepts', payload: { segmentHeadNodeId: string; tipNodeId: string; model?: string | null }): void
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

const { fitView, viewport, setViewport } = useVueFlow()
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
    // `viewport` is a Ref — .value.zoom, not .zoom (see CanvasControls.vue).
    if (Number.isFinite(viewport.value.zoom)) {
      fittedOnce = true
    } else {
      // fitView() against an unmeasured pane/node set can leave the shared
      // viewport's zoom permanently NaN/Infinity — every later zoom step is
      // computed relative to the current value, so once it's corrupted it
      // never recovers on its own (CanvasControls' %, and zoom in/out, both
      // stay frozen forever). Reset to a sane baseline so it can.
      setViewport({ x: 0, y: 0, zoom: 1 })
    }
  }
})

const W = 300

// Estimate card height for dagre. Base layout (header + 2-line summary +
// action toolbar + author/timestamp footer) is constant; every turn —
// including the opener, which is now its own row too (TreeNode.vue's turn
// list, uncapped) — adds its own avatar row, so the estimate must grow with
// the full turn count to avoid overlap.
const ROW_H = 22
function segHeight(s: Segment<TreeNode>) {
  return 148 + 8 + s.nodes.length * ROW_H
}

const MERGED_W = 260
const MERGED_H = 150

// Layout (dagre positions) is expensive, so it stays debounced — but that
// only affects where a card sits, never what it shows (see segments above).
function relayout() {
  const segs = segments.value
  const segIds = new Set(segs.map((s) => s.id))
  // Only merged nodes whose sources are all still visible segments lay out —
  // a source that's since been unshared just drops that one edge rather than
  // erroring dagre with a reference to a node it doesn't have.
  const merged = (props.mergedNodes ?? []).map((mn) => ({
    ...mn,
    sources: mn.sources.filter((s) => segIds.has(s.segmentHeadNodeId)),
  }))

  // Segments (and merged nodes) that weren't around last layout get a one-time
  // "thread" draw-in animation on their incoming edge — but not on the very
  // first layout ever, where everything is "new" and nothing should animate.
  const currentIds = new Set([...segs.map((s) => s.id), ...merged.map((m) => m.id)])
  const newIds = hasSeenSegments
    ? new Set([...currentIds].filter((id) => !knownSegIds.has(id)))
    : new Set<string>()
  knownSegIds = currentIds
  hasSeenSegments = true

  const mergedIds = new Set(merged.map((m) => m.id))
  // A segment forked from a merged node has no parentId of its own (its head
  // is a fresh root, parent_id null — see server/api/chat.post.ts) — without
  // this it would lay out as a disconnected, parentless card even though it
  // clearly continues from that merged node.
  const mergedParentOf = (s: Segment<TreeNode>) =>
    !s.parentId && s.head.parent_merged_node_id && mergedIds.has(s.head.parent_merged_node_id)
      ? s.head.parent_merged_node_id
      : null

  const g = new dagre.graphlib.Graph()
  // Left-to-right cascade (rather than top-down) to match the reference layout.
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const s of segs) g.setNode(s.id, { width: W, height: segHeight(s) })
  for (const s of segs) {
    if (s.parentId) g.setEdge(s.parentId, s.id)
    else {
      const mergedParent = mergedParentOf(s)
      if (mergedParent) g.setEdge(mergedParent, s.id)
    }
  }
  for (const m of merged) {
    g.setNode(m.id, { width: MERGED_W, height: MERGED_H })
    for (const src of m.sources) g.setEdge(src.segmentHeadNodeId, m.id)
  }
  dagre.layout(g)
  const segById = new Map(segs.map((s) => [s.id, s]))
  vfNodes.value = [
    ...segs.map((s) => {
      const p = g.node(s.id)
      return { id: s.id, type: 'msg', position: { x: p.x - W / 2, y: p.y - segHeight(s) / 2 }, data: s }
    }),
    ...merged.map((m) => {
      const p = g.node(m.id)
      return { id: m.id, type: 'merged', position: { x: p.x - MERGED_W / 2, y: p.y - MERGED_H / 2 }, data: m }
    }),
  ]
  vfEdges.value = [
    ...segs
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
      }),
    ...segs
      .filter((s) => mergedParentOf(s))
      .map((s) => {
        const mergedParent = mergedParentOf(s) as string
        return {
          id: `${mergedParent}->${s.id}`,
          source: mergedParent,
          sourceHandle: 'card-src',
          target: s.id,
          animated: false,
          class: newIds.has(s.id) ? 'edge-draw' : undefined,
          style: { stroke: 'var(--accent)', strokeWidth: 1.8 },
        }
      }),
    ...merged.flatMap((m) =>
      m.sources.map((src) => ({
        id: `${src.segmentHeadNodeId}->${m.id}`,
        source: src.segmentHeadNodeId,
        sourceHandle: 'card-src',
        target: m.id,
        animated: false,
        class: newIds.has(m.id) ? 'edge-draw' : undefined,
        style: { stroke: 'var(--accent)', strokeWidth: 1.8 },
      })),
    ),
  ]
}

// Recompute layout when the node set, visibility, or merged nodes change
// (debounced ~150ms).
watch(
  [
    () => props.nodes.map((n) => n.id + n.visibility).join(','),
    () => (props.mergedNodes ?? []).map((m) => m.id).join(','),
  ],
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
          :merge-mode="mergeMode"
          :merge-selected="mergeSelectedIds?.has(data.id) ?? false"
          :highlight-author-id="highlightAuthorId"
          :concepts="conceptsBySegment?.get(data.id) ?? []"
          :concepts-pending="conceptsPending?.has(data.id) ?? false"
          :highlight-concept-id="highlightConceptId"
          @select="(id) => emit('select', id)"
          @fork="(id) => emit('fork', id)"
          @react="(p) => emit('react', p)"
          @unreact="(p) => emit('unreact', p)"
          @toggle-visibility="(ns) => emit('toggle-visibility', ns)"
          @toggle-merge-select="(id) => emit('toggle-merge-select', id)"
          @request-concepts="(p) => emit('request-concepts', p)"
        />
      </template>
      <template #node-merged="{ data }">
        <MergedNodeCard
          :node="data"
          :member-names="memberNames"
          :current-user-id="currentUserId"
          :highlight-author-id="highlightAuthorId"
          :highlight-concept-id="highlightConceptId"
          @fork="(id) => emit('fork-merge', id)"
          @delete="(id) => emit('delete-merge', id)"
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
