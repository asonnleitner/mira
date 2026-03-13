import { GEN_AI_OPERATION_NAME_VALUE_CHAT } from '@opentelemetry/semantic-conventions/incubating'
import { tracedQuery } from '~/agent/query'
import { ANTHROPIC_MODEL_CLAUDE_SONNET, ATTR_BOT_PURPOSE } from '~/constants'
import { logger } from '~/telemetry/logger'

export async function generateMessage(opts: {
  purpose: string
  context?: Record<string, unknown>
  language?: string
}): Promise<string> {
  const languageHint = opts.language && opts.language !== 'auto'
    ? `Respond in ${opts.language}.`
    : 'Respond in the same language as the user context suggests, defaulting to English if unclear.'

  const systemPrompt = [
    'You are Mira, an extremely experienced therapist. You are a real person. A warm, perceptive woman. Generate a single short message for a Telegram bot.',
    'Format your response using Telegram MarkdownV2. Use *bold* (single asterisk) for emphasis. Escape these characters with \\ when literal: _ * [ ] ( ) ~ ` > # + - = | { } . ! — No headers, no quotes, no meta commentary.',
    'Keep it concise (1-3 sentences max).',
    'Be warm and professional.',
    languageHint,
  ].join(' ')

  const prompt = opts.context
    ? `Purpose: ${opts.purpose}\nContext: ${JSON.stringify(opts.context)}`
    : `Purpose: ${opts.purpose}`

  try {
    const { response } = await tracedQuery(
      {
        operationName: GEN_AI_OPERATION_NAME_VALUE_CHAT,
        label: 'messages',
        attributes: {
          [ATTR_BOT_PURPOSE]: opts.purpose,
        },
      },
      {
        prompt,
        options: {
          systemPrompt,
          model: ANTHROPIC_MODEL_CLAUDE_SONNET,
          maxTurns: 1,
          maxBudgetUsd: 1,
          tools: [],
          permissionMode: 'dontAsk',
          stderr: (data: string) => logger.warn('[messages:stderr]', data),
        },
      },
    )

    return response || getFallback(opts.purpose)
  }
  catch (err) {
    logger.error('[messages] generateMessage failed:', err)
    return getFallback(opts.purpose)
  }
}

function getFallback(purpose: string): string {
  const fallbacks: Record<string, string> = {
    check_in: 'Hi\\! It\'s been a little while since we last talked\\. I\'m here whenever you\'d like to chat\\.',
    check_in_couples: 'Hi both\\! It\'s been a little while since our last session\\. I\'m here whenever you\'d like to continue\\.',
  }
  return fallbacks[purpose] ?? 'I\'m here for you.'
}
