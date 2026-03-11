import { drizzle } from 'drizzle-orm/bun-sql'
import { config } from '~/config'

export const db = drizzle(config.DATABASE_URL)
export type Database = typeof db
