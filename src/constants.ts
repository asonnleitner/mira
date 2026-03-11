export const MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
  OPUS: 'claude-opus-4-6',
} as const

export type Model = typeof MODELS[keyof typeof MODELS]
