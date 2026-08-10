import { v4 as uuidv4 } from 'uuid'
import type { AttachmentRef } from '~/composables/useFileUpload'

// Calls /api/chat and consumes the SSE token stream into reactive state.
// Does NOT write to the DB — persistence is server-side; the new nodes arrive
// back through Supabase Realtime (useRealtime).
export function useLLMStream() {
  const streamingText = ref('')
  const streamingReasoning = ref('')
  const isStreaming = ref(false)
  const error = ref<string | null>(null)
  const logger = useActionLogger()

  async function send(opts: {
    conversationId: string
    parentNodeId: string | null
    userText: string
    model: string
    thinking?: string
    attachments?: AttachmentRef[]
    isFork?: boolean
    // Only meaningful when parentNodeId is null: starts a new segment forked
    // from a merged context node (see pages/conversation/[id].vue's
    // activateMergeDraft / server/api/chat.post.ts).
    mergedNodeId?: string
    // Fired synchronously with the (client-generated) user node id, before the
    // request is even sent — lets the caller render the user's turn right
    // away instead of waiting on the full round trip / SSE stream to finish.
    onUserNodeId?: (id: string) => void
  }) {
    isStreaming.value = true
    streamingText.value = ''
    streamingReasoning.value = ''
    error.value = null

    const userNodeId = uuidv4()
    const assistantNodeId = uuidv4()
    opts.onUserNodeId?.(userNodeId)
    const startedAt = performance.now()

    logger.log(
      'send_message',
      {
        text: opts.userText,
        parent_node_id: opts.parentNodeId,
        len: opts.userText.length,
        model: opts.model,
        thinking: opts.thinking,
        attachment_count: opts.attachments?.length ?? 0,
      },
      { conversationId: opts.conversationId, nodeId: userNodeId },
    )

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...opts, userNodeId, assistantNodeId }),
      })
      if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const payload = JSON.parse(t.slice(5).trim())
          if (payload.t) streamingText.value += payload.t
          else if (payload.r) streamingReasoning.value += payload.r
          else if (payload.error) error.value = payload.error
        }
      }

      logger.log(
        'receive_response',
        { node_id: assistantNodeId, tokens: streamingText.value.length, latency_ms: Math.round(performance.now() - startedAt) },
        { conversationId: opts.conversationId, nodeId: assistantNodeId },
      )
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'request failed'
    } finally {
      isStreaming.value = false
    }

    return { userNodeId, assistantNodeId }
  }

  return { streamingText, streamingReasoning, isStreaming, error, send }
}
