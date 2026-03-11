import type { BotContext } from './context'
import { Bot, session } from 'grammy'
import { config } from '~/config'
import { handleHistory, handlePause, handleResume, handleStart, handleStatus } from './handlers/commands'
import { handleMessage } from './handlers/message'
import { sessionConfig } from './session'

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.BOT_TOKEN)

  // Session middleware (PostgreSQL-backed)
  bot.use(session(sessionConfig))

  // Commands
  bot.command('start', handleStart)
  bot.command('status', handleStatus)
  bot.command('pause', handlePause)
  bot.command('resume', handleResume)
  bot.command('history', handleHistory)

  // Text messages → therapy handler
  bot.on('message:text', handleMessage)

  // Error handler
  bot.catch((err) => {
    console.error('Bot error:', err)
  })

  return bot
}
