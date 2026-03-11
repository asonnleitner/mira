import type { NextFunction } from 'grammy'
import type { BotContext } from '~/bot/context'
import { withSpan } from '~/telemetry/tracing'

export async function tracingMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  await withSpan('bot.update', {
    'telegram.user_id': ctx.from?.id ?? 0,
    'telegram.chat_id': ctx.chat?.id ?? 0,
    'telegram.username': ctx.from?.username ?? '',
  }, async () => {
    await next()
  })
}
