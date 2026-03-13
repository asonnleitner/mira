import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const chatTypeValues = ['individual', 'couples'] as const
export type ChatType = (typeof chatTypeValues)[number]

export const chats = sqliteTable('chats', {
  id: integer().primaryKey({ autoIncrement: true }),
  telegramChatId: integer('telegram_chat_id').notNull(),
  type: text({ enum: chatTypeValues }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, table => [
  uniqueIndex('chats_telegram_chat_id_idx').on(table.telegramChatId),
])
