import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { chats } from './chats'
import { patients } from './patients'

export const onboardingStatusValues = ['in_progress', 'complete'] as const
export type OnboardingStatus = (typeof onboardingStatusValues)[number]

export const onboardingTypeValues = ['individual', 'couples'] as const
export type OnboardingType = (typeof onboardingTypeValues)[number]

export const onboardings = sqliteTable('onboardings', {
  id: integer().primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').references(() => chats.id),
  patientId: integer('patient_id').references(() => patients.id),
  type: text({ enum: onboardingTypeValues }).notNull(),
  status: text({ enum: onboardingStatusValues }).notNull().default('in_progress'),
  sdkSessionId: text('sdk_session_id', { length: 256 }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, table => [
  index('onboardings_patient_id_status_idx').on(table.patientId, table.status),
  index('onboardings_chat_id_status_idx').on(table.chatId, table.status),
])
