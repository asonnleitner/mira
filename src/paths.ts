import { join, resolve } from 'node:path'
import { config } from '~/config'

/** Base directory for an individual patient: `{DATA_DIR}/patients/{telegramId}` */
export function patientDir(telegramId: number): string {
  return join(config.DATA_DIR, 'patients', String(telegramId))
}

/** Base directory for a couples chat: `{DATA_DIR}/couples/{chatId}` */
export function couplesDir(chatId: number): string {
  return join(config.DATA_DIR, 'couples', String(chatId))
}

/** PROFILE.md path for an individual patient */
export function patientProfilePath(telegramId: number): string {
  return join(patientDir(telegramId), 'PROFILE.md')
}

/** RELATIONSHIP.md path for a couples chat */
export function relationshipProfilePath(chatId: number): string {
  return join(couplesDir(chatId), 'RELATIONSHIP.md')
}

/** Session transcript path */
export function sessionTranscriptPath(type: 'individual' | 'couples', id: number, sessionTs: number): string {
  const base = type === 'individual' ? patientDir(id) : couplesDir(id)
  return join(base, 'sessions', String(sessionTs), 'transcript.md')
}

/** Resolve the data directory for a session context (individual → patientDir, couples → couplesDir) */
export function sessionDataDir(type: 'individual' | 'couples', telegramId: number, chatId: number): string {
  return resolve(type === 'individual' ? patientDir(telegramId) : couplesDir(chatId))
}
