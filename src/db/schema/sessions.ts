import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const sessionTypeValues = ['individual', 'couples'] as const
export type SessionType = (typeof sessionTypeValues)[number]

export const therapySessions = sqliteTable('therapy_sessions', {
  id: integer().primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull(),
  sdkSessionId: text('sdk_session_id', { length: 256 }),
  type: text({ enum: sessionTypeValues }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastMessageAt: integer('last_message_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  messageCount: integer('message_count').default(0).notNull(),
  transcriptPath: text('transcript_path', { length: 512 }).notNull(),
  soapNotePath: text('soap_note_path', { length: 512 }),
}, table => [
  index('sessions_chat_id_started_at_idx').on(table.chatId, table.startedAt),
  uniqueIndex('sessions_sdk_session_id_idx').on(table.sdkSessionId),
])
