import type { SupabaseClient } from '@supabase/supabase-js'
import type { LLMMessage } from './llm'

// Rebuild the conversation context for a node: walk parent_id to the root via
// the get_lineage() SQL function, oldest→newest, mapped to LLM messages.
export async function buildLineageMessages(
  admin: SupabaseClient,
  nodeId: string,
): Promise<LLMMessage[]> {
  const { data, error } = await admin.rpc('get_lineage', { target: nodeId })
  if (error) {
    throw createError({ statusCode: 500, statusMessage: `lineage failed: ${error.message}` })
  }
  return (data ?? []).map((n: { role: LLMMessage['role']; content: string }) => ({
    role: n.role,
    content: n.content,
  }))
}
