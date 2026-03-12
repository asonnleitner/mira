import type { MenuFlavor } from '@grammyjs/menu'
import type { Context, SessionFlavor } from 'grammy'

export interface SessionData {
  activeSessionId: number | null
  patientId: number | null
  checkInEnabled: boolean | null
  checkInIntervalDays: number | null
}

export type BotContext = Context & SessionFlavor<SessionData> & MenuFlavor
