import { v4 as uuidv4 } from 'uuid'

// Calls /api/chat and consumes the SSE token stream into reactive state.
// Does NOT write to the DB — persistence is server-side; the new nodes arrive
// back through Supabase Realtime (useRealtime).
export function useLLMStream() {
  const streamingText = ref('')
  const isStreaming = ref(false)
  const error = ref<string | null>(null)
  const logger = useActionLogger()

  async function send(opts: {
    conversationId: string
    parentNodeId: string | null
    userText: string
    model: string
    isFork?: boolean
  }) {
    isStreaming.value = true
    streamingText.value = ''
    error.value = null

    const userNodeId = uuidv4()
    const assistantNodeId = uuidv4()
    const startedAt = performance.now()

    logger.log(
      'send_message',
      { text: opts.userText, parent_node_id: opts.parentNodeId, len: opts.userText.length },
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

  return { streamingText, isStreaming, error, send }
}
