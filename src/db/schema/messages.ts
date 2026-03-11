import { index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { patients } from '~/db/schema/patients'
import { therapySessions } from '~/db/schema/sessions'

export const sessionMessages = pgTable('session_messages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sessionId: integer('session_id').notNull().references(() => therapySessions.id),
  patientId: integer('patient_id').references(() => patients.id),
  role: varchar('role', { length: 20 }).notNull(), // "patient" | "therapist" | "system"
  content: text().notNull(),
  timestamp: timestamp().defaultNow().notNull(),
}, table => [
  index('messages_session_id_idx').on(table.sessionId),
  index('messages_timestamp_idx').on(table.timestamp),
])
