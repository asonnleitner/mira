import type { NextFunction } from 'grammy'
import type { BotContext } from '~/bot/context'
import { ATTR_TELEGRAM_CHAT_ID, ATTR_TELEGRAM_USER_ID, ATTR_TELEGRAM_USERNAME } from '~/constants'
import { withSpan } from '~/telemetry/tracing'

function getUpdateType(ctx: BotContext): string {
  if (ctx.message)
    return 'message'
  if (ctx.editedMessage)
    return 'edited_message'
  if (ctx.callbackQuery)
    return 'callback_query'
  if (ctx.inlineQuery)
    return 'inline_query'
  if (ctx.channelPost)
    return 'channel_post'
  if (ctx.editedChannelPost)
    return 'edited_channel_post'
  return 'unknown'
}

export async function tracingMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  await withSpan('bot.update', {
    [ATTR_TELEGRAM_USER_ID]: ctx.from?.id ?? 0,
    [ATTR_TELEGRAM_CHAT_ID]: ctx.chat?.id ?? 0,
    [ATTR_TELEGRAM_USERNAME]: ctx.from?.username ?? '',
    'bot.update_type': getUpdateType(ctx),
  }, async () => {
    await next()
  })
}
