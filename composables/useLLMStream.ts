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
  // The in-flight request's controller, if any — a second send() while one is
  // still streaming (editing the very message it's replying to) aborts it
  // first, since there's only one set of streaming refs to render into. The
  // server keeps generating in the background regardless (network-blip
  // resilience, see chat.post.ts) — chat.post.ts's edit handling makes that
  // now-orphaned reply's persist a no-op rather than an error.
  let controller: AbortController | null = null

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
    // Set when this send replaces a previously-sent message ("Edit" on a
    // message bubble) — see server/api/chat.post.ts for what this triggers.
    editNodeId?: string
    // Fired synchronously with the (client-generated) user node id, before the
    // request is even sent — lets the caller render the user's turn right
    // away instead of waiting on the full round trip / SSE stream to finish.
    onUserNodeId?: (id: string) => void
  }) {
    controller?.abort()
    const myController = new AbortController()
    controller = myController

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
        signal: myController.signal,
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
      // Superseded by a newer send() (edit-while-streaming) — not a real
      // error, and the newer call already owns streamingText/error below.
      if (myController.signal.aborted) return { userNodeId, assistantNodeId }
      error.value = e instanceof Error ? e.message : 'request failed'
    } finally {
      // Only the still-current call gets to clear isStreaming — an aborted
      // older call's finally must not stomp on the newer call's state.
      if (controller === myController) isStreaming.value = false
    }

    return { userNodeId, assistantNodeId }
  }

  return { streamingText, streamingReasoning, isStreaming, error, send }
}
