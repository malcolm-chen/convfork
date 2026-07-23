// Groups message nodes into conversation trajectories ("segments") for the
// tree views: one segment = a maximal linear run of turns. Segments break only
// where the tree genuinely diverges (a parent with 2+ visible children) or at
// a message that explicitly forked a branch (is_fork_point, set at INSERT).
// Continuing to chat on your own branch therefore extends the same segment
// instead of adding one tree node per turn.

export interface SegmentNodeLike {
  id: string
  parent_id: string | null
  is_fork_point?: boolean
}

export interface Segment<T extends SegmentNodeLike> {
  id: string // head node id — stable for the segment's lifetime
  nodes: T[] // in chain order, head → tip
  head: T
  tip: T
  parentId: string | null // id of the parent segment, null for roots
}

export function segmentize<T extends SegmentNodeLike>(nodes: T[]): Segment<T>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, T[]>()
  for (const n of nodes) {
    if (n.parent_id && byId.has(n.parent_id)) {
      const arr = children.get(n.parent_id)
      if (arr) arr.push(n)
      else children.set(n.parent_id, [n])
    }
  }

  // A node starts a new segment if it has no visible parent (root or the
  // parent is hidden by RLS), it forked a branch, or its parent diverges.
  const isStart = (n: T) => {
    if (!n.parent_id || !byId.has(n.parent_id)) return true
    if (n.is_fork_point) return true
    return (children.get(n.parent_id)?.length ?? 0) > 1
  }

  const segByNode = new Map<string, string>()
  const segments: Segment<T>[] = []
  for (const start of nodes) {
    if (!isStart(start)) continue
    const segNodes: T[] = [start]
    segByNode.set(start.id, start.id)
    let cur = start
    for (;;) {
      const kids = children.get(cur.id) ?? []
      if (kids.length !== 1 || isStart(kids[0]!)) break
      cur = kids[0]!
      segNodes.push(cur)
      segByNode.set(cur.id, start.id)
    }
    segments.push({
      id: start.id,
      nodes: segNodes,
      head: start,
      tip: segNodes[segNodes.length - 1]!,
      parentId: null,
    })
  }
  for (const s of segments) {
    const p = s.head.parent_id
    s.parentId = p && byId.has(p) ? (segByNode.get(p) ?? null) : null
  }
  return segments
}
