import type { BotContext } from './context'
import { Bot, session } from 'grammy'
import { config } from '~/config'
import { logger } from '~/telemetry/logger'
import { handleCheckIn } from './handlers/commands'
import { handleMessage } from './handlers/message'
import { checkInMenu } from './menus/check-in'
import { accessControlMiddleware } from './middleware/access-control'
import { tracingMiddleware } from './middleware/tracing'
import { sessionConfig } from './session'

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.BOT_TOKEN)

  // Tracing middleware (must be before session)
  bot.use(tracingMiddleware)

  // Session middleware (PostgreSQL-backed)
  bot.use(session(sessionConfig))

  // Access control — temporary: only allow existing patients
  bot.use(accessControlMiddleware)

  // Menu middleware (must be before command registration)
  bot.use(checkInMenu)

  // Commands
  bot.command('checkin', handleCheckIn)

  // Log when bot is added to or removed from groups
  bot.on('my_chat_member', (ctx) => {
    const chat = ctx.myChatMember.chat
    const newStatus = ctx.myChatMember.new_chat_member.status
    const oldStatus = ctx.myChatMember.old_chat_member.status

    logger.info(`[bot] Chat member status changed in ${chat.type} ${chat.id}: ${oldStatus} → ${newStatus}`)
  })

  // Text messages → therapy handler
  bot.on('message:text', handleMessage)

  // API transformer to log transport/network errors (including polling failures)
  bot.api.config.use(async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal)
    }
    catch (err) {
      logger.error(`[bot] Telegram API call "${method}" failed:`, err)
      throw err
    }
  })

  // Error handler
  bot.catch((err) => {
    logger.error('[bot] Bot error:', err)
  })

  return bot
}
