import { bigint, index, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

export const sessionTypeEnum = pgEnum('session_type', [
  'individual',
  'couples',
])

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'paused',
  'closed',
])

export const therapySessions = pgTable('therapy_sessions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  chatId: bigint('chat_id', { mode: 'number' }).notNull(),
  sdkSessionId: varchar('sdk_session_id', { length: 256 }),
  type: sessionTypeEnum().notNull(),
  status: sessionStatusEnum().default('active').notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  messageCount: integer('message_count').default(0).notNull(),
  transcriptPath: varchar('transcript_path', { length: 512 }).notNull(),
  soapNotePath: varchar('soap_note_path', { length: 512 }),
}, table => [
  index('sessions_chat_id_idx').on(table.chatId),
  index('sessions_status_idx').on(table.status),
])
