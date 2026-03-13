import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { chats } from './chats'
import { patients } from './patients'

export const chatMembers = sqliteTable('chat_members', {
  id: integer().primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull().references(() => chats.id),
  patientId: integer('patient_id').notNull().references(() => patients.id),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, table => [
  uniqueIndex('chat_members_chat_id_patient_id_idx').on(table.chatId, table.patientId),
  index('chat_members_patient_id_idx').on(table.patientId),
])
