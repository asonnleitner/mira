import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { GEN_AI_OPERATION_NAME_VALUE_CHAT } from '@opentelemetry/semantic-conventions/incubating'
import { MODELS } from '~/constants'
import { logger } from '~/telemetry/logger'
import { setGenAiContext, setGenAiResult, withGenAiSpan } from '~/telemetry/tracing'

export async function generateMessage(opts: {
  purpose: string
  context?: Record<string, unknown>
  language?: string
}): Promise<string> {
  return withGenAiSpan(GEN_AI_OPERATION_NAME_VALUE_CHAT, MODELS.HAIKU, {
    'bot.purpose': opts.purpose,
  }, async (span) => {
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

    setGenAiContext(span, {
      systemPrompt,
      inputMessages: [{ role: 'user', content: prompt }],
      toolDefinitions: [],
    })

    try {
      let response = ''
      let resultMsg: SDKResultSuccess | undefined

      const q = query({
        prompt,
        options: {
          systemPrompt,
          model: MODELS.HAIKU,
          maxTurns: 1,
          maxBudgetUsd: 0.005,
          tools: [],
          permissionMode: 'acceptEdits',
          stderr: (data: string) => logger.warn('[messages:stderr]', data),
        },
      })

      for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
          response = message.result
          resultMsg = message
        }
        else if (message.type === 'result') {
          logger.error('[messages] SDK error result:', message)
        }
      }

      setGenAiResult(span, {
        outputMessages: [{ role: 'assistant', content: response }],
        inputTokens: resultMsg?.usage.input_tokens,
        outputTokens: resultMsg?.usage.output_tokens,
        cacheReadInputTokens: resultMsg?.usage.cache_read_input_tokens,
        cacheCreationInputTokens: resultMsg?.usage.cache_creation_input_tokens,
        totalCostUsd: resultMsg?.total_cost_usd,
        responseModel: MODELS.HAIKU,
      })

      return response || getFallback(opts.purpose)
    }
    catch (err) {
      logger.error('generateMessage failed:', err)
      return getFallback(opts.purpose)
    }
  })
}

function getFallback(purpose: string): string {
  const fallbacks: Record<string, string> = {
    welcome_back: 'Welcome back! I\'m here for you.',
    session_paused: 'Session paused. Use /resume when you\'re ready.',
    session_resumed: 'Session resumed. I\'m here whenever you\'re ready.',
    no_active_session: 'No active session. Send a message to start one.',
    no_paused_session: 'No paused session found. Send a message to start a new one.',
    no_history: 'No session history yet.',
  }
  return fallbacks[purpose] ?? 'I\'m here for you.'
}
