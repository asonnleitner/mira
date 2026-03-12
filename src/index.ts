import { sdk } from '~/telemetry/config'
/* eslint-disable perfectionist/sort-imports */
import process from 'node:process'
import { logger } from '~/telemetry/logger'
import { createBot } from './bot/bot'
import { startHealthServer } from './health'
import { startCheckInScheduler, stopCheckInScheduler } from './scheduler/check-in'

const bot = createBot()
let healthServer: ReturnType<typeof startHealthServer> | undefined
let checkInTimer: Timer | undefined

// Start bot with long polling
async function main() {
  try {
    healthServer = startHealthServer()
    logger.info(`Health server listening on port ${healthServer.port}`)

    await bot.start({
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} started!`)
        checkInTimer = startCheckInScheduler(bot.api)
      },
    })
  }
  catch (err) {
    logger.error('Bot crashed:', err)
    process.exit(1)
  }
}

async function shutdown() {
  logger.warn('Shutting down...')
  try {
    if (checkInTimer)
      stopCheckInScheduler(checkInTimer)
    healthServer?.stop()
    await bot.stop()
  }
  catch (err) {
    logger.error('Error during shutdown:', err)
  }
  finally {
    await sdk.shutdown()
    process.exit(0)
  }
}

// Graceful shutdown
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err)
  shutdown().catch(err => logger.error('Shutdown error:', err))
})

main().catch((err) => {
  logger.error('Error during startup:', err)
})
