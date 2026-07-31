import type { SupabaseClient } from '@supabase/supabase-js'
import type { LLMContentBlock, LLMMessage } from './llm'

interface AttachmentRow {
  node_id: string
  filename: string
  content_type: string
  s3_key: string
  kind: 'image' | 'pdf'
}

// Fetches attachment bytes from S3 and inlines them as base64 content blocks.
// Re-sent every turn along with the rest of the lineage, same as the text —
// this app has no context-caching, so that's consistent (if costlier for
// images) with how the whole history is already replayed each turn.
async function attachmentBlocks(atts: AttachmentRow[]): Promise<LLMContentBlock[]> {
  const blocks: LLMContentBlock[] = []
  for (const a of atts) {
    let bytes: Buffer
    try {
      bytes = await getUpload(a.s3_key)
    } catch (err: any) {
      throw createError({
        statusCode: 502,
        statusMessage: `could not fetch attachment "${a.filename}" from storage: ${err?.message || 'unknown S3 error'}`,
      })
    }
    const dataUrl = `data:${a.content_type};base64,${bytes.toString('base64')}`
    blocks.push(
      a.kind === 'image'
        ? { type: 'image_url', image_url: { url: dataUrl } }
        : { type: 'file', file: { file_data: dataUrl, filename: a.filename } },
    )
  }
  return blocks
}

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
  const lineage = (data ?? []) as { id: string; role: LLMMessage['role']; content: string }[]

  const { data: attRows } = await admin
    .from('attachments')
    .select('node_id, filename, content_type, s3_key, kind')
    .in(
      'node_id',
      lineage.map((n) => n.id),
    )
  const attsByNode = new Map<string, AttachmentRow[]>()
  for (const a of (attRows ?? []) as AttachmentRow[]) {
    const arr = attsByNode.get(a.node_id) ?? []
    arr.push(a)
    attsByNode.set(a.node_id, arr)
  }

  const messages: LLMMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const n of lineage) {
    const atts = attsByNode.get(n.id)
    if (!atts?.length) {
      messages.push({ role: n.role, content: n.content })
      continue
    }
    const blocks: LLMContentBlock[] = []
    if (n.content) blocks.push({ type: 'text', text: n.content })
    blocks.push(...(await attachmentBlocks(atts)))
    messages.push({ role: n.role, content: blocks })
  }
  return messages
}
