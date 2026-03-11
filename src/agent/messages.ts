import { query } from '@anthropic-ai/claude-agent-sdk'
import { MODELS } from '~/constants'
import { logger } from '~/telemetry/logger'
import { withGenAiSpan } from '~/telemetry/tracing'

export async function generateMessage(opts: {
  purpose: string
  context?: Record<string, unknown>
  language?: string
}): Promise<string> {
  return withGenAiSpan('chat', MODELS.HAIKU, {
    'bot.purpose': opts.purpose,
  }, async () => {
    const languageHint = opts.language && opts.language !== 'auto'
      ? `Respond in ${opts.language}.`
      : 'Respond in the same language as the user context suggests, defaulting to English if unclear.'

    const systemPrompt = [
      'You are a warm, supportive AI therapy companion generating a single short message for a Telegram bot.',
      'Generate ONLY the message text — no markdown headers, no quotes, no meta commentary.',
      'Keep it concise (1-3 sentences max).',
      'Be warm and professional.',
      languageHint,
    ].join(' ')

    const prompt = opts.context
      ? `Purpose: ${opts.purpose}\nContext: ${JSON.stringify(opts.context)}`
      : `Purpose: ${opts.purpose}`

    try {
      let response = ''

      const q = query({
        prompt,
        options: {
          systemPrompt,
          model: MODELS.HAIKU,
          maxTurns: 1,
          maxBudgetUsd: 0.005,
          tools: [],
        },
      })

      for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
          response = message.result
        }
      }

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
