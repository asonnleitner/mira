import type { BotContext } from '~/bot/context'
import type { SessionType } from '~/db/schema'

export type ChatMode = SessionType

export function detectChatMode(ctx: BotContext): ChatMode {
  const chatType = ctx.chat?.type
  if (chatType === 'private')
    return 'individual'
  // group or supergroup → couples
  return 'couples'
}
