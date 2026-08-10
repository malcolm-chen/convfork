// Provider-agnostic LLM call via the LiteLLM proxy (OpenAI-compatible).
// The backbone is picked per-request (see shared/models.ts + the composer's
// dropdown), not fixed in config.

import { DEFAULT_MODEL_ID, MODEL_OPTIONS, type ThinkingEffort } from '../../shared/models'

// Content blocks follow the OpenAI Chat Completions multimodal shape —
// LiteLLM normalizes these into each provider's native format (verified live:
// image_url and file/file_data both work through the proxy for Anthropic).
export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string; filename: string } }

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LLMContentBlock[]
}

export interface LLMChunk {
  type: 'content' | 'reasoning'
  text: string
}

// Anthropic's adaptive `output_config.effort` and OpenAI's `reasoning_effort`
// accept different enums for the same three UI levels (checked live against
// the proxy — Anthropic 400s on 'minimal'/'instant', OpenAI's is the real
// GPT-5 Chat Completions enum).
const EFFORT_PARAM_VALUES: Record<'anthropic' | 'openai', Record<ThinkingEffort, string>> = {
  anthropic: { instant: 'low', medium: 'medium', high: 'high' },
  openai: { instant: 'minimal', medium: 'medium', high: 'high' },
}

// Builds the extra body params for a thinking request. `thinking` is the
// raw effort value from the client; ignored if the model doesn't support
// thinking or the value isn't a recognized effort level.
function buildThinkingParams(model: string, thinking?: string): Record<string, unknown> {
  const option = MODEL_OPTIONS.find((m) => m.id === model)
  if (!option?.supportsThinking) return {}
  if (thinking !== 'instant' && thinking !== 'medium' && thinking !== 'high') return {}

  if (option.provider === 'anthropic') {
    return { thinking: { type: 'adaptive' }, output_config: { effort: EFFORT_PARAM_VALUES.anthropic[thinking] } }
  }
  return { reasoning_effort: EFFORT_PARAM_VALUES.openai[thinking] }
}

// Streams content + reasoning deltas from LiteLLM's /chat/completions SSE response.
export async function* callLLM(messages: LLMMessage[], model: string, thinking?: string): AsyncGenerator<LLMChunk> {
  const c = useRuntimeConfig()
  let res: Response
  try {
    res = await fetch(`${c.litellmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${c.litellmApiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true, ...buildThinkingParams(model, thinking) }),
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
        const delta = json.choices?.[0]?.delta
        if (delta?.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content as string }
        if (delta?.content) yield { type: 'content', text: delta.content as string }
      } catch {
        // keepalive / partial frame — ignore
      }
    }
  }
}

// Every backbone this deployment actually has a provider key for (mirrors the
// composer dropdown's own filtering in shared/models.ts + nuxt.config.ts).
function configuredModelIds(c: ReturnType<typeof useRuntimeConfig>): string[] {
  return MODEL_OPTIONS.filter((m) =>
    m.provider === 'openai' ? c.public.hasOpenaiKey : c.public.hasAnthropicKey,
  ).map((m) => m.id)
}

async function completeOnce(
  messages: LLMMessage[],
  model: string,
  maxTokens: number,
  c: ReturnType<typeof useRuntimeConfig>,
): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${c.litellmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${c.litellmApiKey}`,
      },
      // No fixed temperature: some backbones (e.g. gpt-5.5, a reasoning
      // model) hard-reject any non-default value with a 400, which
      // completeLLM's fallback chain masked by silently retrying on the
      // next configured model — every call paid for a failed attempt
      // first. Confirmed live against the LiteLLM proxy: identical request
      // succeeds immediately once temperature is omitted.
      body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens }),
    })
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `LiteLLM unreachable at ${c.litellmBaseUrl} — start it with: uv run litellm --config litellm-config.yaml (${err?.message || 'fetch failed'})`,
    })
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw createError({ statusCode: 502, statusMessage: `LLM error ${res.status} (${model}): ${detail.slice(0, 300)}` })
  }
  const json = await res.json()
  return (json.choices?.[0]?.message?.content ?? '').trim()
}

// One-shot (non-streaming) completion — used for short utility calls like the
// node-card auto-summary, where we want the whole text at once, not tokens.
// Unlike callLLM (a user's live chat reply, where switching backbones under
// them would be surprising), this doesn't care which model answers — so if
// the preferred/default one fails (bad key, provider outage, rate limit),
// it falls through to whatever other backbone this deployment has a key for,
// instead of surfacing an error for a background call the user never asked
// to babysit.
export async function completeLLM(
  messages: LLMMessage[],
  opts: { maxTokens?: number; model?: string } = {},
): Promise<string> {
  const c = useRuntimeConfig()
  const available = configuredModelIds(c)
  const preferred = opts.model && available.includes(opts.model) ? opts.model : undefined
  const candidates = [preferred, DEFAULT_MODEL_ID, ...available].filter(
    (m, i, arr): m is string => !!m && available.includes(m) && arr.indexOf(m) === i,
  )
  if (!candidates.length) candidates.push(opts.model ?? DEFAULT_MODEL_ID) // no key configured at all — fail with a real error below

  let lastErr: unknown
  for (const model of candidates) {
    try {
      return await completeOnce(messages, model, opts.maxTokens ?? 32, c)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}
