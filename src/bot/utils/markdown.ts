import { convert } from 'telegram-markdown-v2'

// stripMarkdown patterns
const RE_STRIP_LINK = /\[([^\]]*)\]\(([^)]*)\)/g
const RE_STRIP_CODE_BLOCK = /```[\s\S]*?```/g
const RE_STRIP_INLINE_CODE = /`([^`]*)`/g
const RE_STRIP_SPOILER = /\|\|([^|]*)\|\|/g
const RE_STRIP_UNDERLINE = /__([^_]*)__/g
const RE_STRIP_BOLD = /\*([^*]*)\*/g
const RE_STRIP_ITALIC = /_([^_]*)_/g
const RE_STRIP_STRIKETHROUGH = /~([^~]*)~/g
const RE_UNESCAPE = /\\([_*[\]()~`>#+\-=|{}.!\\])/g

/**
 * Convert standard Markdown to Telegram MarkdownV2 format.
 *
 * Uses an AST-based parser (remark/unified) to properly handle
 * nested formatting, special character escaping, and edge cases.
 */
export function sanitizeMarkdownV2(text: string): string {
  return convert(text, 'escape').trimEnd()
}

/**
 * Strip MarkdownV2 formatting to produce plain text.
 * Used as a fallback when sanitized markdown still fails.
 */
export function stripMarkdown(text: string): string {
  let s = text

  // Convert links [text](url) → text (url)
  s = s.replace(RE_STRIP_LINK, '$1 ($2)')

  // Remove code blocks but keep content
  s = s.replace(RE_STRIP_CODE_BLOCK, match => match.slice(3, -3).trim())

  // Remove inline code markers
  s = s.replace(RE_STRIP_INLINE_CODE, '$1')

  // Remove formatting markers: ||, __, *, _, ~
  s = s.replace(RE_STRIP_SPOILER, '$1')
  s = s.replace(RE_STRIP_UNDERLINE, '$1')
  s = s.replace(RE_STRIP_BOLD, '$1')
  s = s.replace(RE_STRIP_ITALIC, '$1')
  s = s.replace(RE_STRIP_STRIKETHROUGH, '$1')

  // Unescape \X → X
  s = s.replace(RE_UNESCAPE, '$1')

  return s
}
