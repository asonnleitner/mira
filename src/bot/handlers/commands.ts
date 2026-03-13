import type { BotContext } from '~/bot/context'
import { detectChatMode } from '~/bot/router'
import { ATTR_BOT_COMMAND } from '~/constants'
import { findOrCreateChat } from '~/db/queries/chats'
import { findOrCreatePreference } from '~/db/queries/check-in'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

export async function handleCheckIn(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.checkin', { [ATTR_BOT_COMMAND]: 'checkin' }, async () => {
    const telegramChatId = ctx.chat!.id
    const chatMode = detectChatMode(ctx)

    logger.debug(`[commands] /checkin from chatId=${telegramChatId}`)

    // Resolve internal chat ID
    const chat = await findOrCreateChat(telegramChatId, chatMode)
    const pref = await findOrCreatePreference(chat.id)

    ctx.session.checkInEnabled = pref.enabled
    ctx.session.checkInIntervalDays = pref.intervalDays

    const status = pref.enabled
      ? `Check\\-ins are *enabled* every *${pref.intervalDays} day\\(s\\)*\\.`
      : 'Check\\-ins are currently *disabled*\\.'

    const { checkInMenu } = await import('~/bot/menus/check-in')

    await ctx.reply(status, {
      parse_mode: 'MarkdownV2',
      reply_markup: checkInMenu,
    })
  })
}
