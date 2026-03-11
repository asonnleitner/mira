import type { Context, SessionFlavor } from 'grammy'

export interface SessionData {
  activeSessionId: number | null
  patientId: number | null
}

export type BotContext = Context & SessionFlavor<SessionData>
