import type { NextFunction } from 'grammy'
import type { BotContext } from '~/bot/context'
import { findPatientByTelegramId } from '~/db/queries/patients'
import { logger } from '~/telemetry/logger'

export async function accessControlMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const telegramId = ctx.from?.id

  if (!telegramId)
    return next()

  const patient = await findPatientByTelegramId(telegramId)

  if (!patient) {
    logger.debug(`[access-control] Rejected unknown user: telegramId=${telegramId} username=${ctx.from?.username}`)
    return
  }

  return next()
}
