import type { BotContext } from '~/bot/context'
import { Menu } from '@grammyjs/menu'
import { detectChatMode } from '~/bot/router'
import { findOrCreateChat } from '~/db/queries/chats'
import { updateCheckInPreference } from '~/db/queries/check-in'
import { logger } from '~/telemetry/logger'

export const checkInMenu = new Menu<BotContext>('check-in-menu')
  // Row 1: Enable/disable toggle
  .text(
    async (ctx) => {
      const pref = ctx.session.checkInEnabled
      return pref ? '\u2713 Enabled' : '\u25CB Disabled'
    },
    async (ctx) => {
      const telegramChatId = ctx.chat!.id
      const telegramId = ctx.from!.id
      const chatMode = detectChatMode(ctx)
      const chat = await findOrCreateChat(telegramChatId, chatMode)
      const newEnabled = !ctx.session.checkInEnabled

      await updateCheckInPreference(chat.id, telegramId, { enabled: newEnabled })

      logger.debug(`[check-in-menu] Toggle: chatId=${telegramChatId} enabled=${newEnabled}`)

      ctx.session.checkInEnabled = newEnabled
      ctx.menu.update()
    },
  )
  .row()
  // Row 2: Interval presets
  .text(
    ctx => ctx.session.checkInIntervalDays === 1 ? '\u2022 1d' : '1d',
    async (ctx) => {
      await setInterval_(ctx, 1)
    },
  )
  .text(
    ctx => ctx.session.checkInIntervalDays === 3 ? '\u2022 3d' : '3d',
    async (ctx) => {
      await setInterval_(ctx, 3)
    },
  )
  .text(
    ctx => ctx.session.checkInIntervalDays === 5 ? '\u2022 5d' : '5d',
    async (ctx) => {
      await setInterval_(ctx, 5)
    },
  )
  .text(
    ctx => ctx.session.checkInIntervalDays === 7 ? '\u2022 7d' : '7d',
    async (ctx) => {
      await setInterval_(ctx, 7)
    },
  )
  .text(
    ctx => ctx.session.checkInIntervalDays === 14 ? '\u2022 14d' : '14d',
    async (ctx) => {
      await setInterval_(ctx, 14)
    },
  )

async function setInterval_(ctx: BotContext, days: number) {
  const telegramChatId = ctx.chat!.id
  const telegramId = ctx.from!.id
  const chatMode = detectChatMode(ctx)
  const chat = await findOrCreateChat(telegramChatId, chatMode)

  await updateCheckInPreference(chat.id, telegramId, { intervalDays: days })

  logger.debug(`[check-in-menu] Interval changed: chatId=${telegramChatId} days=${days}`)

  ctx.session.checkInIntervalDays = days
  ctx.menu.update()
}
