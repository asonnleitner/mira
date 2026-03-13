import { sql } from 'drizzle-orm'
import { integer, sqliteTable, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { chats } from './chats'

export const checkInPreferences = sqliteTable('check_in_preferences', {
  id: integer().primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull().references(() => chats.id),
  enabled: integer({ mode: 'boolean' }).default(true).notNull(),
  intervalDays: integer('interval_days').default(3).notNull(),
  lastCheckInAt: integer('last_check_in_at', { mode: 'timestamp' }),
  unansweredCount: integer('unanswered_count').default(0).notNull(),
  lastModifiedBy: integer('last_modified_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, table => [
  uniqueIndex('check_in_preferences_chat_id_idx').on(table.chatId),
])
