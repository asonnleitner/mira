import type { SoapNote } from '~/db/zod'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ATTR_STORAGE_FILE_PATH } from '~/constants'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

export async function writeSoapNote(
  filePath: string,
  sessionId: number,
  date: string,
  note: SoapNote,
): Promise<void> {
  return withSpan('storage.soapNote.write', { [ATTR_STORAGE_FILE_PATH]: filePath }, async () => {
    await mkdir(dirname(filePath), { recursive: true })

    const sections = [
      `# SOAP Note: Session #${sessionId} | ${date}`,
      '',
      '## S: Subjective',
      ...note.subjective.map(s => `- ${s}`),
      '',
      '## O: Objective',
      ...note.objective.map(s => `- ${s}`),
      '',
      '## A: Assessment',
      ...note.assessment.map(s => `- ${s}`),
      '',
      '## P: Plan',
      ...note.plan.map(s => `- ${s}`),
      '',
    ]

    await Bun.write(filePath, sections.join('\n'))

    logger.debug(`[storage] Wrote SOAP note for session ${sessionId} to ${filePath}`)
  })
}

export async function readSoapNote(filePath: string): Promise<string> {
  return withSpan('storage.soapNote.read', { [ATTR_STORAGE_FILE_PATH]: filePath }, async () => {
    const file = Bun.file(filePath)

    if (await file.exists())
      return file.text()

    return ''
  })
}
