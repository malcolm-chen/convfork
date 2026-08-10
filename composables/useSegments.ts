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
  // "Diverges" only counts OTHER non-fork children — a fork already gets its
  // own segment via the is_fork_point rule above, so it must never split its
  // origin's existing continuation into two cards too. Forking from turn 3
  // of someone's 5-turn conversation must leave that conversation's card
  // whole; only the fork's own (separate, private-until-shared) branch is new.
  const isStart = (n: T) => {
    if (!n.parent_id || !byId.has(n.parent_id)) return true
    if (n.is_fork_point) return true
    const siblings = children.get(n.parent_id) ?? []
    return siblings.filter((s) => !s.is_fork_point).length > 1
  }

  const segByNode = new Map<string, string>()
  const segments: Segment<T>[] = []
  for (const start of nodes) {
    if (!isStart(start)) continue
    const segNodes: T[] = [start]
    segByNode.set(start.id, start.id)
    let cur = start
    for (;;) {
      // Ignore fork-point children here too — they're picked up as their own
      // segment starts by the outer loop, and must not stop (or fork off)
      // this segment's own walk through its actual, non-fork continuation.
      const nonForkKids = (children.get(cur.id) ?? []).filter((k) => !k.is_fork_point)
      if (nonForkKids.length !== 1 || isStart(nonForkKids[0]!)) break
      cur = nonForkKids[0]!
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

/**
 * Keep only segments that have actually been shared with the team (at least
 * one shared node) — a segment that's still entirely private draft work
 * (e.g. a just-forked branch, before its author shares it) stays out of any
 * shared-facing tree view. Descendants of a hidden segment re-parent to the
 * nearest ancestor segment that IS visible, rather than being orphaned or
 * dropped themselves.
 */
export function sharedSegments<T extends SegmentNodeLike & { visibility: string }>(
  all: Segment<T>[],
): Segment<T>[] {
  const byId = new Map(all.map((s) => [s.id, s]))
  const isPublic = (s: Segment<T>) => s.nodes.some((n) => n.visibility === 'shared')
  const visibleIds = new Set(all.filter(isPublic).map((s) => s.id))
  function nearestVisibleAncestor(s: Segment<T>): string | null {
    let cur = s.parentId ? byId.get(s.parentId) : undefined
    while (cur) {
      if (visibleIds.has(cur.id)) return cur.id
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return null
  }
  return all.filter(isPublic).map((s) => ({ ...s, parentId: nearestVisibleAncestor(s) }))
}

/**
 * Sequential "C" numbering for the canvas badges (C1, C2, …) and the
 * "Forked from C1-2" breadcrumb — ordered by when each segment was *first
 * shared*, not when it was created. A segment with no shared node at all
 * (private, own-only) isn't part of this order and won't appear in the map.
 */
export function sharedOrder<T extends SegmentNodeLike & { visibility: string; created_at: string }>(
  segments: Segment<T>[],
): Map<string, number> {
  const withShared = segments
    .map((s) => {
      const sharedTimes = s.nodes.filter((n) => n.visibility === 'shared').map((n) => n.created_at)
      return sharedTimes.length
        ? { id: s.id, firstShared: sharedTimes.reduce((a, b) => (a < b ? a : b)) }
        : null
    })
    .filter((x): x is { id: string; firstShared: string } => x !== null)
    .sort((a, b) => a.firstShared.localeCompare(b.firstShared))
  return new Map(withShared.map((x, i) => [x.id, i + 1]))
}

/** 1-based position of a node within its own segment's chain (head → tip). */
export function turnNumberOf<T extends SegmentNodeLike>(segment: Segment<T>, nodeId: string): number {
  return segment.nodes.findIndex((n) => n.id === nodeId) + 1
}
