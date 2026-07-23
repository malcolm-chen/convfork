<script setup lang="ts">
import { segmentize } from '~/composables/useSegments'

// Small SVG rendering of a conversation's branch structure for the dashboard
// cards. One dot = one trajectory (linear runs of turns collapse into a single
// dot, matching the main tree view). Layout: x = depth, leaves get evenly
// spaced rows and each internal node sits at the mean of its children.
interface MiniNode {
  id: string
  parent_id: string | null
  is_fork_point?: boolean
  created_at?: string
}

const props = defineProps<{ nodes: MiniNode[] }>()

const W = 168
const H = 84
const PAD = 12

interface Dot { id: string; x: number; y: number; r: number; cls: string }

const layout = computed(() => {
  // Collapse trajectories, then lay out the segment graph as pseudo-nodes.
  const nodes = segmentize(props.nodes)
    .map((s) => ({
      id: s.id,
      parent_id: s.parentId,
      is_fork_point: !!s.head.is_fork_point,
      created_at: s.nodes.reduce((m, n) => ((n.created_at ?? '') > m ? n.created_at! : m), ''),
    }))
    .slice(0, 48)
  if (!nodes.length) return null

  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<string, MiniNode[]>()
  const roots: MiniNode[] = []
  for (const n of nodes) {
    if (n.parent_id && ids.has(n.parent_id)) {
      const list = children.get(n.parent_id)
      if (list) list.push(n)
      else children.set(n.parent_id, [n])
    } else {
      roots.push(n)
    }
  }

  const pos = new Map<string, { x: number; y: number }>()
  let leafY = 0
  let maxDepth = 0
  const assign = (n: MiniNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth)
    const kids = children.get(n.id) ?? []
    const y = kids.length
      ? kids.map((k) => assign(k, depth + 1)).reduce((a, b) => a + b, 0) / kids.length
      : leafY++
    pos.set(n.id, { x: depth, y })
    return y
  }
  roots.forEach((r) => assign(r, 0))

  const rows = Math.max(1, leafY - 1)
  const sx = (d: number) => PAD + (maxDepth ? d / maxDepth : 0.5) * (W - 2 * PAD)
  const sy = (y: number) => (leafY <= 1 ? H / 2 : PAD + (y / rows) * (H - 2 * PAD))

  const latestId = nodes.reduce(
    (best, n) => ((n.created_at ?? '') > (best?.created_at ?? '') ? n : best),
    nodes[0],
  ).id

  const edges: string[] = []
  const dots: Dot[] = []
  for (const n of nodes) {
    const p = pos.get(n.id)!
    const x = sx(p.x)
    const y = sy(p.y)
    if (n.parent_id && ids.has(n.parent_id)) {
      const pp = pos.get(n.parent_id)!
      const px = sx(pp.x)
      const py = sy(pp.y)
      const mx = (px + x) / 2
      edges.push(`M ${px} ${py} C ${mx} ${py}, ${mx} ${y}, ${x} ${y}`)
    }
    const isRoot = !n.parent_id || !ids.has(n.parent_id)
    const cls = n.id === latestId ? 'tip' : n.is_fork_point ? 'fork' : isRoot ? 'root' : 'node'
    dots.push({ id: n.id, x, y, r: isRoot ? 4.5 : n.id === latestId ? 3.5 : 3, cls })
  }
  return { edges, dots }
})
</script>

<template>
  <svg class="minitree" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="branch structure">
    <template v-if="layout">
      <path v-for="(d, i) in layout.edges" :key="i" :d="d" class="edge" />
      <circle
        v-for="dot in layout.dots"
        :key="dot.id"
        :cx="dot.x"
        :cy="dot.y"
        :r="dot.r"
        :class="dot.cls"
      />
    </template>
    <template v-else>
      <!-- ghost placeholder for conversations with no visible nodes yet -->
      <path :d="`M ${PAD + 6} ${H / 2} H ${W - PAD - 6}`" class="edge ghost" />
      <circle :cx="PAD + 6" :cy="H / 2" r="4.5" class="ghostdot" />
      <circle :cx="W / 2" :cy="H / 2" r="3" class="ghostdot" />
      <circle :cx="W - PAD - 6" :cy="H / 2" r="3" class="ghostdot" />
    </template>
  </svg>
</template>

<style scoped>
.minitree { display: block; width: 100%; height: 100%; }
.edge { fill: none; stroke: #cfc9bb; stroke-width: 1.3; }
.edge.ghost { stroke-dasharray: 3 4; opacity: 0.7; }
.node { fill: #8f887a; }
.root { fill: #23262f; }
.fork { fill: #f6f5f1; stroke: #2f56d9; stroke-width: 1.6; }
.tip { fill: #2f56d9; }
.ghostdot { fill: #ddd8cc; }
</style>
