import { config } from './config'
import { logger } from './telemetry/logger'

let botReady = false

export function setBotReady(ready: boolean) {
  botReady = ready
}

export function startHealthServer() {
  return Bun.serve({
    port: config.PORT,
    fetch(req) {
      if (new URL(req.url).pathname === '/health') {
        if (!botReady) {
          logger.warn('[health] Health check returned 503: bot not ready')
          return Response.json({ status: 'not ready' }, { status: 503 })
        }
        return Response.json({ status: 'ok' })
      }
      return new Response('Not Found', { status: 404 })
    },
  })
}
