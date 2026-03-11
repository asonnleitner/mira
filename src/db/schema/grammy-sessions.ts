import { jsonb, pgTable, text } from 'drizzle-orm/pg-core'

export const grammySessions = pgTable('grammy_sessions', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
})
