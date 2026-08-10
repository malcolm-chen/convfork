// Loads a project's concept assignments (RLS-scoped) and requests tagging
// for segments that don't have any yet — mirrors composables/useMergedNodes.ts
// (a per-page store, not a bare module singleton, since concepts are scoped
// per conversation/project).
//
// Tagging is always sent as ONE combined request covering every segment
// that needs it, not one request per segment — see server/utils/concepts.ts
// for why (a single call lets the model see every segment at once and
// naturally avoid minting near-duplicate concepts across them, and avoids
// firing a burst of concurrent requests that reliably tripped the LLM
// provider's rate limit).

export interface ConceptTag {
  id: string
  name: string
  description: string
}

export function useConcepts(conversationId: string) {
  const supabase = useSupabaseClient()

  // Full registry actually in use on this canvas right now (for the Topic
  // dropdown) — populated from refresh() and from each tagging response.
  const concepts = ref<ConceptTag[]>([])
  // segmentHeadNodeId -> its ranked (<=3) assigned concepts.
  const bySegment = reactive(new Map<string, ConceptTag[]>())
  // segmentHeadNodeId currently awaiting a tagging response — drives the
  // shimmer placeholder in TreeNode.vue.
  const pending = reactive(new Set<string>())

  function addToRegistry(tags: ConceptTag[]) {
    for (const c of tags) {
      if (!concepts.value.some((x) => x.id === c.id)) concepts.value.push(c)
    }
  }

  async function refresh() {
    const { data, error } = await supabase
      .from('segment_concepts')
      .select('segment_head_node_id, score, concepts!inner(id, name, description, conversation_id)')
      .eq('concepts.conversation_id', conversationId)
      .order('score', { ascending: false })
    if (error) return
    bySegment.clear()
    for (const row of (data ?? []) as any[]) {
      const tag: ConceptTag = { id: row.concepts.id, name: row.concepts.name, description: row.concepts.description }
      const list = bySegment.get(row.segment_head_node_id) ?? []
      list.push(tag)
      bySegment.set(row.segment_head_node_id, list)
      addToRegistry([tag])
    }
  }

  // Tags every given segment that doesn't already have an assignment, in
  // ONE request. Safe to call with a batch that includes already-tagged
  // segments — those are simply skipped.
  async function requestMany(segs: { segmentHeadNodeId: string; tipNodeId: string }[], model?: string | null) {
    if (!import.meta.client) return
    const targets = segs.filter((s) => !bySegment.has(s.segmentHeadNodeId))
    if (!targets.length) return
    for (const s of targets) pending.add(s.segmentHeadNodeId)
    try {
      const r = await $fetch<{ segments: Record<string, ConceptTag[]> }>('/api/concepts/assign', {
        method: 'POST',
        body: {
          conversationId,
          segments: targets.map((s) => ({ segmentHeadNodeId: s.segmentHeadNodeId, tipNodeId: s.tipNodeId })),
          model,
        },
      })
      for (const [id, tags] of Object.entries(r.segments)) {
        bySegment.set(id, tags)
        addToRegistry(tags)
      }
    } catch (err) {
      console.error('[concepts] tagging failed', err)
    } finally {
      for (const s of targets) pending.delete(s.segmentHeadNodeId)
    }
  }

  // Convenience wrapper for a single segment (e.g. one freshly-shared node
  // while the canvas is already open) — still just a 1-element batch call.
  function request(segmentHeadNodeId: string, tipNodeId: string, model?: string | null, force = false) {
    if (!import.meta.client) return
    if (!force && bySegment.has(segmentHeadNodeId)) return
    requestMany([{ segmentHeadNodeId, tipNodeId }], model)
  }

  // Wipes this project's concept vocabulary server-side and local state, so
  // the next requestMany() call re-tags every segment from scratch (e.g.
  // after tuning the prompt).
  async function reset() {
    await $fetch('/api/concepts/reset', { method: 'POST', body: { conversationId } })
    concepts.value = []
    bySegment.clear()
  }

  return { concepts, bySegment, pending, refresh, request, requestMany, reset }
}
