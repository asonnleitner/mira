import type { NextFunction } from 'grammy'
import type { BotContext } from '~/bot/context'
import { ATTR_TELEGRAM_CHAT_ID, ATTR_TELEGRAM_USER_ID, ATTR_TELEGRAM_USERNAME } from '~/constants'
import { withSpan } from '~/telemetry/tracing'

export async function tracingMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  await withSpan('bot.update', {
    [ATTR_TELEGRAM_USER_ID]: ctx.from?.id ?? 0,
    [ATTR_TELEGRAM_CHAT_ID]: ctx.chat?.id ?? 0,
    [ATTR_TELEGRAM_USERNAME]: ctx.from?.username ?? '',
  }, async () => {
    await next()
  })
}
