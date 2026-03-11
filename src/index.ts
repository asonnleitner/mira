import process from 'node:process'
import { createBot } from './bot/bot'

const bot = createBot()

// Start bot with long polling
async function main() {
  try {
    await bot.start({
      onStart: (botInfo) => {
        console.warn(`Bot @${botInfo.username} started!`)
      },
    })
  }
  catch (err) {
    console.error('Bot crashed:', err)
    process.exit(1)
  }
}

async function shutdown() {
  console.warn('Shutting down...')
  try {
    await bot.stop()
  }
  catch (err) {
    console.error('Error during shutdown:', err)
  }
  finally {
    process.exit(0)
  }
}

// Graceful shutdown
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err)
  shutdown().catch(console.error)
})

main().catch((err) => {
  console.error('Error during shutdown:', err)
})
