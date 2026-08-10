import type { SupabaseClient } from '@supabase/supabase-js'

// Mirrors composables/useConversation.ts's TreeNode/Attachment — duplicated
// here (rather than imported) because server/ code never reaches into
// client composables in this codebase; get_lineage()'s `setof nodes` return
// shape lines up with these fields column-for-column.
interface ShareNode {
  id: string
  conversation_id: string
  parent_id: string | null
  author_id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string | null
  visibility: 'private' | 'shared'
  is_fork_point: boolean
  model: string | null
  parent_merged_node_id: string | null
  created_at: string
}

interface ShareAttachment {
  id: string
  node_id: string
  filename: string
  content_type: string
  size_bytes: number
  kind: 'image' | 'pdf'
  created_at: string
}

interface ShareRow {
  id: string
  conversation_id: string
  node_id: string
}

// Loads the share row a link points at. Returns null if it doesn't exist —
// callers turn that into a 404, same as any other missing resource.
export async function loadShareRow(admin: SupabaseClient, shareId: string): Promise<ShareRow | null> {
  const { data } = await admin
    .from('conversation_shares')
    .select('id, conversation_id, node_id')
    .eq('id', shareId)
    .single()
  return (data as ShareRow) ?? null
}

export interface ShareContent {
  conversationTitle: string
  nodes: ShareNode[] // root -> tip, frozen at share.node_id
  memberNames: Record<string, string>
  attachments: ShareAttachment[]
}

// Full read for the public share page: the frozen lineage plus enough about
// its authors/attachments to render with the same ThreadPanel component the
// live conversation view uses (see pages/share/[id].vue).
export async function loadShareContent(admin: SupabaseClient, shareId: string): Promise<ShareContent | null> {
  const share = await loadShareRow(admin, shareId)
  if (!share) return null

  const { data: convo } = await admin.from('conversations').select('title').eq('id', share.conversation_id).single()

  const { data: lineage, error } = await admin.rpc('get_lineage', { target: share.node_id })
  if (error) throw createError({ statusCode: 500, statusMessage: `share lineage failed: ${error.message}` })
  const nodes = (lineage ?? []) as ShareNode[]
  if (!nodes.length) return { conversationTitle: convo?.title || 'Shared conversation', nodes: [], memberNames: {}, attachments: [] }

  const authorIds = [...new Set(nodes.map((n) => n.author_id))]
  const { data: authors } = await admin.from('users').select('id, display_name').in('id', authorIds)
  const memberNames = Object.fromEntries((authors ?? []).map((a: any) => [a.id, a.display_name as string]))

  const { data: attachments } = await admin
    .from('attachments')
    .select('id, node_id, filename, content_type, size_bytes, kind, created_at')
    .in(
      'node_id',
      nodes.map((n) => n.id),
    )

  return {
    conversationTitle: convo?.title || 'Shared conversation',
    nodes,
    memberNames,
    attachments: (attachments ?? []) as ShareAttachment[],
  }
}

// Membership check for the public attachment route: is this attachment's
// node part of the share's frozen lineage? A conversation_id match alone
// isn't enough — the shared tip might not be the conversation's newest node,
// so this also walks the lineage to confirm the node is actually on it.
export async function attachmentNodeInShare(
  admin: SupabaseClient,
  shareId: string,
  attachmentId: string,
): Promise<{ s3_key: string; filename: string; content_type: string } | null> {
  const share = await loadShareRow(admin, shareId)
  if (!share) return null

  const { data: att } = await admin
    .from('attachments')
    .select('s3_key, filename, content_type, node_id, nodes(conversation_id)')
    .eq('id', attachmentId)
    .single()
  if (!att) return null
  const node = Array.isArray((att as any).nodes) ? (att as any).nodes[0] : (att as any).nodes
  if (!node || node.conversation_id !== share.conversation_id) return null

  // Confirm the attachment's node is actually an ancestor of (or is) the
  // share's frozen tip, not just some other node in the same conversation.
  const { data: lineage } = await admin.rpc('get_lineage', { target: share.node_id })
  const inLineage = ((lineage ?? []) as { id: string }[]).some((n) => n.id === (att as any).node_id)
  if (!inLineage) return null

  return { s3_key: att.s3_key as string, filename: att.filename as string, content_type: att.content_type as string }
}
