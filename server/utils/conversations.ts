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
// team_interaction_logs rows are study data — they are kept; only their node
// references are nulled to satisfy the FK (schema has no cascades).
export async function purgeConversationNodes(admin: SupabaseClient, conversationId: string) {
  const { data: nodeRows, error: listErr } = await admin
    .from('nodes')
    .select('id')
    .eq('conversation_id', conversationId)
  if (listErr) throw createError({ statusCode: 500, statusMessage: `list nodes: ${listErr.message}` })
  const ids = (nodeRows ?? []).map((r) => r.id)
  if (!ids.length) return 0

  // reactions.node_id has no ON DELETE CASCADE — remove them first (chunked to
  // keep PostgREST filter URLs bounded)
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await admin.from('reactions').delete().in('node_id', ids.slice(i, i + 100))
    if (error) throw createError({ statusCode: 500, statusMessage: `delete reactions: ${error.message}` })
  }

  // detach interaction logs from the doomed nodes; the rows themselves stay.
  // Every log writer (api/chat + the 0006 triggers) sets conversation_id, so
  // filtering by it covers all refs into this tree.
  for (const col of ['source_node_id', 'result_node_id'] as const) {
    const { error } = await admin
      .from('team_interaction_logs')
      .update({ [col]: null })
      .eq('conversation_id', conversationId)
      .not(col, 'is', null)
    if (error) throw createError({ statusCode: 500, statusMessage: `detach logs: ${error.message}` })
  }

  // one statement deletes the whole tree; the parent_id self-FK is satisfied
  // because parents and children go in the same statement
  const { error: delErr } = await admin.from('nodes').delete().eq('conversation_id', conversationId)
  if (delErr) throw createError({ statusCode: 500, statusMessage: `delete nodes: ${delErr.message}` })

  return ids.length
}
