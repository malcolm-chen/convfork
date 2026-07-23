// Provider-agnostic LLM call via the LiteLLM proxy (OpenAI-compatible).
// Switching the backbone is config (.env + litellm-config.yaml), not code.

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Streams text deltas from LiteLLM's /chat/completions SSE response.
export async function* callLLM(messages: LLMMessage[]): AsyncGenerator<string> {
  const c = useRuntimeConfig()
  let res: Response
  try {
    res = await fetch(`${c.litellmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${c.litellmApiKey}`,
      },
      body: JSON.stringify({ model: c.llmModel, messages, stream: true }),
    })
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `LiteLLM unreachable at ${c.litellmBaseUrl} — start it with: uv run litellm --config litellm-config.yaml (${err?.message || 'fetch failed'})`,
    })
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw createError({ statusCode: 502, statusMessage: `LLM error ${res.status}: ${detail.slice(0, 300)}` })
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the partial last line
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield delta as string
      } catch {
        // keepalive / partial frame — ignore
      }
    }
  }
}

// One-shot (non-streaming) completion — used for short utility calls like the
// node-card auto-summary, where we want the whole text at once, not tokens.
export async function completeLLM(
  messages: LLMMessage[],
  opts: { maxTokens?: number } = {},
): Promise<string> {
  const c = useRuntimeConfig()
  let res: Response
  try {
    res = await fetch(`${c.litellmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${c.litellmApiKey}`,
      },
      body: JSON.stringify({
        model: c.llmModel,
        messages,
        stream: false,
        max_tokens: opts.maxTokens ?? 32,
        temperature: 0.2,
      }),
    })
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `LiteLLM unreachable at ${c.litellmBaseUrl} — start it with: uv run litellm --config litellm-config.yaml (${err?.message || 'fetch failed'})`,
    })
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw createError({ statusCode: 502, statusMessage: `LLM error ${res.status}: ${detail.slice(0, 300)}` })
  }
  const json = await res.json()
  return (json.choices?.[0]?.message?.content ?? '').trim()
}
