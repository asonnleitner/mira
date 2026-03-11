import type { SessionOptions } from 'grammy'
import type { BotContext, SessionData } from '~/bot/context'
import { sql } from 'drizzle-orm'
import { db } from '~/db'

// Simple PostgreSQL-backed session storage using a dedicated table.
// We create the table on startup if it doesn't exist.

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS grammy_sessions (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
)`

let initialized = false

async function ensureTable() {
  if (initialized)
    return
  await db.execute(sql.raw(INIT_SQL))
  initialized = true
}

export const sessionStorage = {
  async read(key: string): Promise<SessionData | undefined> {
    await ensureTable()
    const rows = await db.execute<{ value: SessionData }>(
      sql`SELECT value FROM grammy_sessions WHERE key = ${key}`,
    )
    return rows[0]?.value
  },

  async write(key: string, value: SessionData): Promise<void> {
    await ensureTable()
    await db.execute(
      sql`INSERT INTO grammy_sessions (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}::jsonb`,
    )
  },

  async delete(key: string): Promise<void> {
    await ensureTable()
    await db.execute(
      sql`DELETE FROM grammy_sessions WHERE key = ${key}`,
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
