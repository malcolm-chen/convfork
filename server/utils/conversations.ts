import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'

// Shared gate for conversation-mutating routes (clear / rename / delete):
// authenticated caller who belongs to the conversation's team.
export async function requireConversationMember(event: H3Event, conversationId: string | undefined) {
  const user = await requireUser(event)
  if (!conversationId) {
    throw createError({ statusCode: 400, statusMessage: 'conversationId required' })
  }

  const admin = useSupabaseAdmin()

  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id')
    .eq('id', conversationId)
    .single()
  if (!convo) throw createError({ statusCode: 404, statusMessage: 'conversation not found' })

  const { data: profile } = await admin
    .from('users')
    .select('team_id')
    .eq('id', user.id)
    .single()
  if (!profile || profile.team_id !== convo.team_id) {
    throw createError({ statusCode: 403, statusMessage: 'not a member of this team' })
  }

  return { user, admin, convo }
}

// Delete every node in a conversation plus their reactions.
export async function purgeConversationNodes(admin: SupabaseClient, conversationId: string) {
  const { data: nodeRows, error: listErr } = await admin
    .from('nodes')
    .select('id')
    .eq('conversation_id', conversationId)
  if (listErr) throw createError({ statusCode: 500, statusMessage: `list nodes: ${listErr.message}` })
  const ids = (nodeRows ?? []).map((r) => r.id)
  if (!ids.length) return 0
  await purgeNodesByIds(admin, ids)
  return ids.length
}

// Delete a specific set of nodes (plus their reactions), used both by the
// whole-tree clear/delete above and by deleting a merged context node's
// dependent forks (server/api/merge/delete.post.ts) — there, only the
// doomed ids' own log references should be detached, not the whole
// conversation's, since unrelated segments in the same tree survive.
// team_interaction_logs rows are study data — they are kept; only their node
// references are nulled to satisfy the FK (schema has no cascades).
export async function purgeNodesByIds(admin: SupabaseClient, ids: string[]) {
  if (!ids.length) return

  // reactions.node_id has no ON DELETE CASCADE — remove them first (chunked to
  // keep PostgREST filter URLs bounded)
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await admin.from('reactions').delete().in('node_id', ids.slice(i, i + 100))
    if (error) throw createError({ statusCode: 500, statusMessage: `delete reactions: ${error.message}` })
  }

  for (const col of ['source_node_id', 'result_node_id'] as const) {
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await admin
        .from('team_interaction_logs')
        .update({ [col]: null })
        .in(col, ids.slice(i, i + 100))
      if (error) throw createError({ statusCode: 500, statusMessage: `detach logs: ${error.message}` })
    }
  }

  // One statement deletes every id — the parent_id self-FK is satisfied
  // because parents and children go in the same statement. Unlike the steps
  // above, this one must NOT be chunked: splitting it across statements
  // could delete a parent row before a later batch deletes its still-
  // referencing child, violating the FK.
  const { error: delErr } = await admin.from('nodes').delete().in('id', ids)
  if (delErr) throw createError({ statusCode: 500, statusMessage: `delete nodes: ${delErr.message}` })
}

// Every node transitively descended from any of rootIds (inclusive), within
// one conversation — used to find "everything that only exists because of
// this merge" when deleting a merged context node (its forked segments, and
// anything forked from THOSE in turn).
export async function collectDescendantIds(
  admin: SupabaseClient,
  conversationId: string,
  rootIds: string[],
): Promise<string[]> {
  const { data, error } = await admin.from('nodes').select('id, parent_id').eq('conversation_id', conversationId)
  if (error) throw createError({ statusCode: 500, statusMessage: `list nodes: ${error.message}` })

  const childrenOf = new Map<string, string[]>()
  for (const n of (data ?? []) as { id: string; parent_id: string | null }[]) {
    if (!n.parent_id) continue
    const arr = childrenOf.get(n.parent_id)
    if (arr) arr.push(n.id)
    else childrenOf.set(n.parent_id, [n.id])
  }

  const result: string[] = []
  const queue = [...rootIds]
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
    queue.push(...(childrenOf.get(id) ?? []))
  }
  return result
}
