import type { BotContext } from '~/bot/context'

export type ChatMode = 'individual' | 'couples'

export function detectChatMode(ctx: BotContext): ChatMode {
  const chatType = ctx.chat?.type
  if (chatType === 'private')
    return 'individual'
  // group or supergroup → couples
  return 'couples'
}
