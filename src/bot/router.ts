import type { BotContext } from '~/bot/context'
import type { SessionType } from '~/db/schema'
import { logger } from '~/telemetry/logger'

export type ChatMode = SessionType

export function detectChatMode(ctx: BotContext): ChatMode {
  const chatType = ctx.chat?.type

  const mode: ChatMode = chatType === 'private' ? 'individual' : 'couples'

  logger.debug(`[router] detectChatMode chatId=${ctx.chat?.id} chatType=${chatType} mode=${mode}`)

  return mode
}
