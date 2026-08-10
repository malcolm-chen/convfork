// Loads a project's merged context nodes (RLS-scoped), each with its source
// conversation nodes' (segments') head ids and authors — enough to render
// MergedNodeCard.vue and its incoming edges on the canvas without a second
// round-trip.

export interface MergedSourceRef {
  segmentHeadNodeId: string
  authorId: string
}

export interface MergedNode {
  id: string
  title: string
  summary: string
  createdAt: string
  createdBy: string
  sources: MergedSourceRef[]
}

export function useMergedNodes(conversationId: string) {
  const supabase = useSupabaseClient()
  const nodes = ref<MergedNode[]>([])

  async function refresh() {
    const { data, error } = await supabase
      .from('merged_context_nodes')
      .select('id, title, summary, created_at, created_by, merged_context_sources(segment_head_node_id, author_id)')
      .eq('conversation_id', conversationId)
    if (error) return
    nodes.value = (data ?? []).map((n: any) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      createdAt: n.created_at,
      createdBy: n.created_by,
      sources: (n.merged_context_sources ?? []).map((s: any) => ({
        segmentHeadNodeId: s.segment_head_node_id,
        authorId: s.author_id,
      })),
    }))
  }

  return { nodes, refresh }
}
