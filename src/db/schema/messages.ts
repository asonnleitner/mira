import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { patients } from './patients'
import { therapySessions } from './sessions'

export const sessionMessages = sqliteTable('session_messages', {
  id: integer().primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id').notNull().references(() => therapySessions.id),
  patientId: integer('patient_id').references(() => patients.id),
  role: text('role', { length: 20, enum: ['patient', 'therapist', 'system'] }).notNull(), // "patient" | "therapist" | "system"
  content: text().notNull(),
  timestamp: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, table => [
  index('messages_session_id_idx').on(table.sessionId),
  index('messages_timestamp_idx').on(table.timestamp),
])
