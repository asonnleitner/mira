import type { SessionOptions, StorageAdapter } from 'grammy'
import type { BotContext, SessionData } from '~/bot/context'
import { eq } from 'drizzle-orm'
import { db, tables } from '~/db'
import { withDbSpan } from '~/telemetry/tracing'

export const sessionStorage: StorageAdapter<SessionData> = {
  async read(key: string): Promise<SessionData | undefined> {
    const rows = await withDbSpan(
      db.select({ value: tables.grammySessions.value })
        .from(tables.grammySessions)
        .where(eq(tables.grammySessions.key, key)),
    )
    return rows[0]?.value as SessionData | undefined
  },

  async write(key: string, value: SessionData): Promise<void> {
    await withDbSpan(
      db.insert(tables.grammySessions)
        .values({ key, value })
        .onConflictDoUpdate({
          target: tables.grammySessions.key,
          set: { value },
        }),
    )
  },

  async delete(key: string): Promise<void> {
    await withDbSpan(
      db.delete(tables.grammySessions)
        .where(eq(tables.grammySessions.key, key)),
    )
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
