import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const MESSAGE_HEADER_RE = /(?=\n## \d{2}:\d{2}:\d{2} [—|] )/

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19) // HH:MM:SS
}

export async function createTranscript(
  filePath: string,
  metadata: {
    type: 'individual' | 'couples'
    patient: string
    sessionId: number
    startedAt: Date
  },
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const dateStr = metadata.startedAt.toISOString().split('T')[0]
  const content = `# Therapy Session | ${dateStr}

**Type:** ${metadata.type === 'individual' ? 'Individual' : 'Couples'}
**Patient:** ${metadata.patient}
**Session ID:** ${metadata.sessionId}
**Started:** ${metadata.startedAt.toISOString()}

---
`
  await Bun.write(filePath, content)
}

export async function appendMessage(
  filePath: string,
  role: 'Patient' | 'Therapist' | 'System',
  content: string,
  timestamp: Date = new Date(),
  patientLabel?: string,
): Promise<void> {
  const time = formatTime(timestamp)
  const label = patientLabel ? `${role} (${patientLabel})` : role
  const block = `\n## ${time} | ${label}\n${content}\n`
  await Bun.write(filePath, (await readTranscript(filePath)) + block)
}

export async function readTranscript(filePath: string): Promise<string> {
  const file = Bun.file(filePath)

  if (await file.exists())
    return file.text()

  return ''
}

export async function readRecentMessages(filePath: string, count: number): Promise<string> {
  const content = await readTranscript(filePath)

  if (!content)
    return ''

  const blocks = content.split(MESSAGE_HEADER_RE)
  const header = blocks[0] // frontmatter
  const messages = blocks.slice(1)

  if (messages.length <= count)
    return content

  return header + messages.slice(-count).join('')
}
