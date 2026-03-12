import process from 'node:process'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from '~/db'
import { logger } from '~/telemetry/logger'

try {
  logger.info('Running database migrations...')
  migrate(db, { migrationsFolder: './drizzle' })
  logger.success('Migrations applied successfully')
}
catch (err) {
  logger.error('Migration failed:', err)
  process.exitCode = 1
}
