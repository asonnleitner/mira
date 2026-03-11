import type { SessionOptions } from 'grammy'
import type { BotContext, SessionData } from '~/bot/context'
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { grammySessions } from '~/db/schema'

export const sessionStorage = {
  async read(key: string): Promise<SessionData | undefined> {
    const row = await db
      .select({ value: grammySessions.value })
      .from(grammySessions)
      .where(eq(grammySessions.key, key))
      .then(rows => rows[0])
    return row?.value as SessionData | undefined
  },

  async write(key: string, value: SessionData): Promise<void> {
    await db
      .insert(grammySessions)
      .values({ key, value })
      .onConflictDoUpdate({
        target: grammySessions.key,
        set: { value },
      })
  },

  async delete(key: string): Promise<void> {
    await db
      .delete(grammySessions)
      .where(eq(grammySessions.key, key))
  },
}

export const sessionConfig: SessionOptions<SessionData, BotContext> = {
  initial: () => ({
    activeSessionId: null,
    patientId: null,
  }),
  storage: sessionStorage,
  getSessionKey: ctx => ctx.chat?.id.toString(),
}
