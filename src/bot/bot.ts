import type { BotContext } from './context'
import { Bot, session } from 'grammy'
import { config } from '~/config'
import { logger } from '~/telemetry/logger'
import { handleCheckIn, handleHistory, handlePause, handleResume, handleStart, handleStatus } from './handlers/commands'
import { handleMessage } from './handlers/message'
import { checkInMenu } from './menus/check-in'
import { tracingMiddleware } from './middleware/tracing'
import { sessionConfig } from './session'

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.BOT_TOKEN)

  // Tracing middleware (must be before session)
  bot.use(tracingMiddleware)

  // Session middleware (PostgreSQL-backed)
  bot.use(session(sessionConfig))

  // Menu middleware (must be before command registration)
  bot.use(checkInMenu)

  // Commands
  bot.command('start', handleStart)
  bot.command('status', handleStatus)
  bot.command('pause', handlePause)
  bot.command('resume', handleResume)
  bot.command('history', handleHistory)
  bot.command('checkin', handleCheckIn)

  // Text messages → therapy handler
  bot.on('message:text', handleMessage)

  // Error handler
  bot.catch((err) => {
    logger.error('Bot error:', err)
  })

  return bot
}
