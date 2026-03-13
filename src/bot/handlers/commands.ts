import type { BotContext } from '~/bot/context'
import { ATTR_BOT_COMMAND } from '~/constants'
import { findOrCreatePreference } from '~/db/queries/check-in'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

export async function handleCheckIn(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.checkin', { [ATTR_BOT_COMMAND]: 'checkin' }, async () => {
    const chatId = ctx.chat!.id

    logger.debug(`[commands] /checkin from chatId=${chatId}`)

    const pref = await findOrCreatePreference(chatId)

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
