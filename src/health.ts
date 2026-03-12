import { config } from './config'

export function startHealthServer() {
  return Bun.serve({
    port: config.PORT,
    fetch(req) {
      if (new URL(req.url).pathname === '/health') {
        return Response.json({ status: 'ok' })
      }
      return new Response('Not Found', { status: 404 })
    },
  })
}
