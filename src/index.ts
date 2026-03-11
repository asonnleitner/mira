import process from 'node:process'
import { createBot } from '~/bot/bot'

const bot = createBot()

// Start bot with long polling
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started!`)
  },
})

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...')
  bot.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
