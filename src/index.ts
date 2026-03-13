import { sdk } from '~/telemetry/config'
/* eslint-disable perfectionist/sort-imports */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { config } from '~/config'
import { logger } from '~/telemetry/logger'
import { createBot } from './bot/bot'
import { setBotReady, startHealthServer } from './health'
import { startCheckInScheduler, stopCheckInScheduler } from './scheduler/check-in'

const bot = createBot()
let healthServer: ReturnType<typeof startHealthServer> | undefined
let checkInTimer: Timer | undefined

// Start bot with long polling
async function main() {
  try {
    // Ensure base data directories exist before any agent calls
    await mkdir(join(config.DATA_DIR, 'patients'), { recursive: true })
    await mkdir(join(config.DATA_DIR, 'couples'), { recursive: true })

    healthServer = startHealthServer()
    logger.info(`[boot] Health server listening on port ${healthServer.port}`)

    logger.info('[boot] Connecting to Telegram...')

    const connectionTimeout = setTimeout(() => {
      logger.warn('[boot] Bot has not connected to Telegram after 30s — check network, DNS, TLS, and BOT_TOKEN')
    }, 30_000)

    await bot.start({
      onStart: (botInfo) => {
        clearTimeout(connectionTimeout)
        setBotReady(true)
        logger.info(`[boot] Bot @${botInfo.username} started!`)
        checkInTimer = startCheckInScheduler(bot.api)
      },
    })
  }
  catch (err) {
    logger.error('[boot] Bot crashed:', err)
    process.exit(1)
  }
}

async function shutdown() {
  logger.warn('[boot] Shutting down...')
  try {
    if (checkInTimer)
      stopCheckInScheduler(checkInTimer)
    healthServer?.stop()
    await bot.stop()
  }
  catch (err) {
    logger.error('[boot] Error during shutdown:', err)
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
  logger.error('[boot] Unhandled rejection:', err)
  shutdown().catch(err => logger.error('[boot] Shutdown error:', err))
})

main().catch((err) => {
  logger.error('[boot] Error during startup:', err)
})
