<script setup lang="ts">
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import dagre from 'dagre'
import NodeCard from '~/components/tree/TreeNode.vue'
import { segmentize, type Segment } from '~/composables/useSegments'
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
const segments = computed(() => segmentize(props.nodes))
const segmentsById = computed(() => new Map(segments.value.map((s) => [s.id, s])))

const vfNodes = ref<any[]>([])
const vfEdges = ref<any[]>([])
let timer: ReturnType<typeof setTimeout> | null = null

const W = 300

// Estimate card height for dagre. Cards show a fixed layout — header + a 2-line
// summary title + a single-row action toolbar (reactions + fork) — so the
// height is constant.
function segHeight(_s: Segment<TreeNode>) {
  return 120
}

// Layout (dagre positions) is expensive, so it stays debounced — but that
// only affects where a card sits, never what it shows (see segments above).
function relayout() {
  const segs = segments.value
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 56 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const s of segs) g.setNode(s.id, { width: W, height: segHeight(s) })
  for (const s of segs) if (s.parentId) g.setEdge(s.parentId, s.id)
  dagre.layout(g)
  vfNodes.value = segs.map((s) => {
    const p = g.node(s.id)
    return { id: s.id, type: 'msg', position: { x: p.x - W / 2, y: p.y - segHeight(s) / 2 }, data: s }
  })
  vfEdges.value = segs
    .filter((s) => s.parentId)
    .map((s) => ({
      id: `${s.parentId}->${s.id}`,
      source: s.parentId as string,
      target: s.id,
      animated: false,
      style: { stroke: '#cfc9bb', strokeWidth: 1.6 },
    }))
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
    <VueFlow :nodes="vfNodes" :edges="vfEdges" :fit-view-on-init="true" :min-zoom="0.2" :max-zoom="1.5">
      <template #node-msg="{ data }">
        <NodeCard
          :segment="segmentsById.get(data.id) ?? data"
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
      <Background pattern-color="#d8d3c6" :gap="22" />
      <Controls />
    </VueFlow>
  </div>
</template>

<style scoped>
.treewrap { height: 100%; width: 100%; }
</style>
