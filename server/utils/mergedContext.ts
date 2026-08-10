import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'

// Shared gate for the merge endpoints: authenticated caller + their team id.
export async function requireCallerTeam(event: H3Event) {
  const user = await requireUser(event)
  const admin = useSupabaseAdmin()
  const { data: profile } = await admin.from('users').select('team_id').eq('id', user.id).single()
  if (!profile?.team_id) throw createError({ statusCode: 403, statusMessage: 'no team' })
  return { user, admin, teamId: profile.team_id as string }
}

export interface SnapshotMessage {
  id: string
  role: 'user' | 'assistant'
  authorName: string
  content: string
  created_at: string
}

interface LineageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  author_id: string
  visibility: string
  created_at: string
}

// A "conversation node" on the canvas (see composables/useSegments.ts) is a
// maximal linear run of turns identified by its head node's id. Its snapshot
// is that segment's own chain — head through a frozen tip — never its
// ancestor segments' history, so merging one card never silently pulls in
// whatever it was forked from.
//
// get_lineage(tip) already walks parent_id all the way to the true
// conversation root (oldest→newest); slicing from headNodeId onward turns
// that into exactly this segment's chain, without re-implementing
// useSegments.ts's branch-detection heuristic server-side.
export async function fetchSegmentSnapshot(
  admin: SupabaseClient,
  headNodeId: string,
  tipNodeId: string,
): Promise<SnapshotMessage[]> {
  const { data, error } = await admin.rpc('get_lineage', { target: tipNodeId })
  if (error) throw createError({ statusCode: 500, statusMessage: `snapshot fetch: ${error.message}` })
  const full = (data ?? []) as LineageRow[]
  const headIdx = full.findIndex((n) => n.id === headNodeId)
  if (headIdx === -1) {
    throw createError({ statusCode: 400, statusMessage: 'segment head is not an ancestor of the given tip' })
  }
  const shared = full.slice(headIdx).filter((n) => n.visibility === 'shared')
  if (!shared.length) return []

  const authorIds = [...new Set(shared.map((n) => n.author_id))]
  const { data: authors } = await admin.from('users').select('id, display_name').in('id', authorIds)
  const nameById = new Map((authors ?? []).map((a: any) => [a.id, a.display_name as string]))

  return shared.map((n) => ({
    id: n.id,
    role: n.role,
    authorName: n.role === 'assistant' ? 'AI Assistant' : nameById.get(n.author_id) ?? 'Unknown',
    content: n.content,
    created_at: n.created_at,
  }))
}

// Human-readable label for a source row — the segment's own opening line
// (first shared user turn, falling back to its first shared turn at all),
// truncated. Purely for display/serialization; never used for identity.
function labelFor(snapshot: SnapshotMessage[]): string {
  const first = snapshot.find((m) => m.role === 'user') ?? snapshot[0]
  const clean = (first?.content ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? clean.slice(0, 59) + '…' : clean || 'Untitled'
}

// Loaded merged node + its sources, each with a label and the frozen
// snapshot as of its own cutoff — the single read path shared by the
// LLM-context builder (below) and GET /api/merge/[id] (chat-panel display).
export async function loadMergedContext(admin: SupabaseClient, mergedNodeId: string) {
  const { data: node, error: nodeErr } = await admin
    .from('merged_context_nodes')
    .select('id, conversation_id, title, summary')
    .eq('id', mergedNodeId)
    .single()
  if (nodeErr || !node) throw createError({ statusCode: 404, statusMessage: 'merged node not found' })

  const { data: sourceRows, error: srcErr } = await admin
    .from('merged_context_sources')
    .select('segment_head_node_id, author_id, included_through_turn_id')
    .eq('merged_node_id', mergedNodeId)
  if (srcErr) throw createError({ statusCode: 500, statusMessage: `sources: ${srcErr.message}` })

  const sources = await Promise.all(
    (sourceRows ?? []).map(async (s: any) => {
      const messages = await fetchSegmentSnapshot(admin, s.segment_head_node_id, s.included_through_turn_id)
      return {
        segmentHeadNodeId: s.segment_head_node_id as string,
        authorId: s.author_id as string,
        label: labelFor(messages),
        messages,
      }
    }),
  )

  return {
    conversationId: node.conversation_id as string,
    title: node.title as string,
    summary: node.summary as string,
    sources,
  }
}

// Serializes the merged node + its frozen source segments for the LLM,
// keeping every source visibly separate (bracketed tags) so the model never
// conflates independent contributors into one shared back-and-forth.
export async function buildMergedContextSystemMessage(admin: SupabaseClient, mergedNodeId: string): Promise<string> {
  const { title, summary, sources } = await loadMergedContext(admin, mergedNodeId)

  const parts = [`[Merged context: ${title}]`, summary].filter(Boolean)
  for (const s of sources) {
    parts.push(`\n[Source conversation node: ${s.label}]`)
    for (const m of s.messages) {
      parts.push(`[Speaker: ${m.authorName}]\n${m.content}`)
    }
  }
  return parts.join('\n')
}
