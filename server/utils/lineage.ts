import type { SupabaseClient } from '@supabase/supabase-js'
import type { LLMMessage } from './llm'

// No system prompt here at all was the base-model default: heavy on bullet
// lists and hedging, light on natural conversational tone. This steers it the
// other way, toward how people actually text back and forth.
const SYSTEM_PROMPT = `You are a knowledgeable, easygoing conversational partner in a live text chat.

Write like a sharp, friendly person replying in the moment — flowing prose in short paragraphs, not a report. Only use a bulleted or numbered list when the content is genuinely a sequence of discrete steps or items AND a list would be clearly easier to follow than prose — never as your default structure. Skip headers, bold "key terms", and restating the question back before answering. Match your reply's length to the question: quick questions get quick answers; only go long when the topic truly calls for it.`

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
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(data ?? []).map((n: { role: LLMMessage['role']; content: string }) => ({
      role: n.role,
      content: n.content,
    })),
  ]
}
