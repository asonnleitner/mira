import { drizzle } from 'drizzle-orm/bun-sql'
import { config } from '~/config'
import { relations, schema } from '~/db/schema'

export const db = drizzle(config.DATABASE_URL, { schema, relations })
export type Database = typeof db
