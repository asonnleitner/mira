import { drizzle } from 'drizzle-orm/bun-sql'
import { config } from '~/config'
import { relations } from '~/db/schema'
import * as schema from './schema/index'

export const db = drizzle(config.DATABASE_URL, { schema, relations })
export type Database = typeof db
