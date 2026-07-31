// Model backbones offered in the composer's dropdown. `id` must match a
// `model_name` in litellm-config.yaml. Imported (by relative path, not
// auto-import) from both server/ and components/, so it stays the single
// source of truth for both the dropdown and server-side validation.

// Every current backbone that supports thinking takes a 3-level effort dial
// (verified against the live LiteLLM proxy) — Anthropic via
// thinking: { type: 'adaptive' }, output_config: { effort }, OpenAI via
// reasoning_effort. Same three UI levels, different accepted enums per
// provider — see EFFORT_PARAM_VALUES in server/utils/llm.ts.
export type ThinkingEffort = 'instant' | 'medium' | 'high'

export interface ModelOption {
  id: string
  label: string
  provider: 'openai' | 'anthropic'
  supportsThinking?: boolean
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai', supportsThinking: true },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai', supportsThinking: true },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', supportsThinking: true },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', supportsThinking: true },
]

export const DEFAULT_MODEL_ID = 'gpt-5.5'
