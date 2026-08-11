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

// Same prompt for every backbone — callLLM() never branches the message
// content on `model`, only the reasoning-effort param (see EFFORT_PARAM_VALUES
// in llm.ts). Kept as a plain .txt server asset (nuxt.config.ts's
// nitro.serverAssets) rather than a code string so it can be edited directly
// without a code change — no system prompt at all was the base-model default:
// heavy on bullet lists and hedging, light on natural conversational tone.
async function loadSystemPrompt(): Promise<string> {
  const raw = await useStorage('assets:prompts').getItemRaw('system-prompt.txt')
  if (!raw) throw createError({ statusCode: 500, statusMessage: 'server/assets/prompts/system-prompt.txt not found' })
  return raw.toString('utf8').trim()
}

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
  const lineage = (data ?? []) as {
    id: string
    role: LLMMessage['role']
    content: string
    parent_merged_node_id: string | null
  }[]

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

  const messages: LLMMessage[] = [{ role: 'system', content: await loadSystemPrompt() }]
  // If this lineage's root (oldest row — a fresh segment forked from a merged
  // context node, see server/api/chat.post.ts) carries a merged-node
  // reference, splice its frozen source trajectories in here, on every turn,
  // rather than ever copying them into this segment's own nodes.
  const mergedNodeId = lineage[0]?.parent_merged_node_id
  if (mergedNodeId) {
    messages.push({ role: 'system', content: await buildMergedContextSystemMessage(admin, mergedNodeId) })
  }
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
