import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SoapNote {
  subjective: string[]
  objective: string[]
  assessment: string[]
  plan: string[]
}

export async function writeSoapNote(
  filePath: string,
  sessionId: number,
  date: string,
  note: SoapNote,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const sections = [
    `# SOAP Note — Session #${sessionId} — ${date}`,
    '',
    '## S — Subjective',
    ...note.subjective.map(s => `- ${s}`),
    '',
    '## O — Objective',
    ...note.objective.map(s => `- ${s}`),
    '',
    '## A — Assessment',
    ...note.assessment.map(s => `- ${s}`),
    '',
    '## P — Plan',
    ...note.plan.map(s => `- ${s}`),
    '',
  ]

  await Bun.write(filePath, sections.join('\n'))
}

export async function readSoapNote(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  if (await file.exists()) {
    return file.text()
  }
  return ''
}
