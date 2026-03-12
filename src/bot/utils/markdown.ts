// Characters that must be escaped in MarkdownV2 (outside formatting entities)
const SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g

// sanitizeMarkdownV2 patterns
const RE_ALREADY_ESCAPED = /\\([_*[\]()~`>#+\-=|{}.!\\])/g
const RE_CODE_BLOCK = /```([\s\S]*?)```/g
const RE_INLINE_CODE = /`([^`\n]+)`/g
const RE_INLINE_LINK = /\[([^\]]*)\]\(([^)]*)\)/g
const RE_SPOILER = /\|\|([^|]+)\|\|/g
const RE_UNDERLINE = /__([^_]+)__/g
const RE_BOLD = /\*([^*]+)\*/g
const RE_ITALIC = /_([^_]+)_/g
const RE_STRIKETHROUGH = /~([^~]+)~/g
const RE_PLACEHOLDER = /\0(\d+)\0/g

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

const FORMAT_PATTERNS: [RegExp, string, string][] = [
  [RE_SPOILER, '||', '||'],
  [RE_UNDERLINE, '__', '__'],
  [RE_BOLD, '*', '*'],
  [RE_ITALIC, '_', '_'],
  [RE_STRIKETHROUGH, '~', '~'],
]

/**
 * Sanitize text for Telegram MarkdownV2 parse mode.
 *
 * Preserves valid formatting (bold, italic, code, links, etc.)
 * while escaping special characters in plain-text regions.
 */
export function sanitizeMarkdownV2(text: string): string {
  const placeholders: string[] = []

  function ph(content: string): string {
    const idx = placeholders.length
    placeholders.push(content)
    return `\x00${idx}\x00`
  }

  let s = text

  // 1. Protect already-escaped characters (don't double-escape)
  s = s.replace(RE_ALREADY_ESCAPED, (_, char) => ph(`\\${char}`))

  // 2. Protect code blocks (``` ... ```)
  s = s.replace(RE_CODE_BLOCK, match => ph(match))

  // 3. Protect inline code (` ... `)
  s = s.replace(RE_INLINE_CODE, match => ph(match))

  // 4. Protect inline links [text](url)
  s = s.replace(RE_INLINE_LINK, (_, linkText, url) => {
    const sanitizedText = sanitizeMarkdownV2(linkText)
    return ph(`[${sanitizedText}](${url})`)
  })

  // 5. Protect formatting pairs in order: ||, __, *, _, ~
  for (const [pattern, open, close] of FORMAT_PATTERNS) {
    s = s.replace(pattern, (_, content) => {
      const sanitizedContent = sanitizeMarkdownV2(content)
      return ph(`${open}${sanitizedContent}${close}`)
    })
  }

  // 6. Escape remaining special characters
  s = s.replace(SPECIAL_CHARS, char => `\\${char}`)

  // 7. Restore all placeholders (handle nested placeholders)
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(RE_PLACEHOLDER, (_, idx) => placeholders[Number(idx)])
  }

  return s
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
