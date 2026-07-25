// Model backbones offered in the composer's dropdown. `id` must match a
// `model_name` in litellm-config.yaml. Imported (by relative path, not
// auto-import) from both server/ and components/, so it stays the single
// source of truth for both the dropdown and server-side validation.

export interface ModelOption {
  id: string
  label: string
  provider: 'openai' | 'anthropic'
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt-5.3', label: 'GPT-5.3', provider: 'openai' },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai' },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic' },
]

export const DEFAULT_MODEL_ID = 'gpt-5.4'
