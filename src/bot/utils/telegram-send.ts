import type { Api } from 'grammy'
import type { BotContext } from '~/bot/context'
import { sanitizeMarkdownV2, stripMarkdown } from '~/bot/utils/markdown'
import { logger } from '~/telemetry/logger'

interface SendOptions {
  chatId: number
  text: string
  api: Api
}

/**
 * Send a message with MarkdownV2 formatting, falling back to plain text
 * if Telegram rejects the formatting.
 */
export async function sendMarkdownV2({ chatId, text, api }: SendOptions): Promise<void> {
  const sanitized = sanitizeMarkdownV2(text)
  const chunks = splitMessage(sanitized, 4096)

  for (const chunk of chunks) {
    try {
      await api.sendMessage(chatId, chunk, { parse_mode: 'MarkdownV2' })
    }
    catch (err) {
      if (isParseEntityError(err)) {
        logger.warn(`[telegram-send] MarkdownV2 parse failed for chat ${chatId}, falling back to plain text`)
        const plain = stripMarkdown(chunk)
        await api.sendMessage(chatId, plain)
      }
      else {
        throw err
      }
    }
  }
}

/**
 * Reply to a context message with MarkdownV2, falling back to plain text.
 */
export async function replyMarkdownV2(ctx: BotContext, text: string): Promise<void> {
  const sanitized = sanitizeMarkdownV2(text)
  const chunks = splitMessage(sanitized, 4096)

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'MarkdownV2' })
    }
    catch (err) {
      if (isParseEntityError(err)) {
        logger.warn(`[telegram-send] MarkdownV2 parse failed, falling back to plain text`)
        const plain = stripMarkdown(chunk)
        await ctx.reply(plain)
      }
      else {
        throw err
      }
    }
  }
}

function isParseEntityError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: string }).message
    return msg.includes('can\'t parse entities')
  }
  return false
}

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    // Try to split at a paragraph break
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen)

    if (splitIdx === -1 || splitIdx < maxLen / 2) {
      // Fall back to splitting at a newline
      splitIdx = remaining.lastIndexOf('\n', maxLen)
    }

    if (splitIdx === -1 || splitIdx < maxLen / 2) {
      // Fall back to splitting at a space
      splitIdx = remaining.lastIndexOf(' ', maxLen)
    }

    if (splitIdx === -1) {
      splitIdx = maxLen
    }

    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}
