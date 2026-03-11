import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const grammySessions = sqliteTable('grammy_sessions', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).notNull(),
})
