import { drizzle } from 'drizzle-orm/bun-sql'
import { config } from '~/config'
import { relations } from '~/db/relations'
import * as schema from '~/db/schema'

const databaseUrl = `postgres://${config.POSTGRES_USER}:${config.POSTGRES_PASSWORD}@${config.POSTGRES_HOST}:${config.POSTGRES_PORT}/${config.POSTGRES_DB}`

export const db = drizzle(databaseUrl, { schema, relations })
export type Database = typeof db
export const tables = schema
