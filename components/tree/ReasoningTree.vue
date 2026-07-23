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

function relayout() {
  // One graph node per conversation trajectory, not per turn.
  const segments = segmentize(props.nodes)
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 56 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const s of segments) g.setNode(s.id, { width: W, height: segHeight(s) })
  for (const s of segments) if (s.parentId) g.setEdge(s.parentId, s.id)
  dagre.layout(g)
  vfNodes.value = segments.map((s) => {
    const p = g.node(s.id)
    return { id: s.id, type: 'msg', position: { x: p.x - W / 2, y: p.y - segHeight(s) / 2 }, data: s }
  })
  vfEdges.value = segments
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
          :segment="data"
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
