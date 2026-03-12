import { Database as BunDatabase } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import { config } from '~/config'
import { relations } from '~/db/relations'
import * as schema from '~/db/schema'

const client = new BunDatabase(config.DATABASE_URL)
export const db = drizzle({ client, schema, relations })
export type Database = typeof db
export const tables = schema
