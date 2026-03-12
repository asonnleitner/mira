import process from 'node:process'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from '~/db'
import { sdk } from '~/telemetry/config'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

async function main() {
  await withSpan('db.migrate', { 'db.system': 'sqlite' }, async () => {
    logger.info('Running database migrations...')
    migrate(db, { migrationsFolder: './drizzle' })
    logger.success('Migrations applied successfully')
  })
}

main()
  .catch((err) => {
    logger.error('Migration failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await sdk.shutdown().catch(() => {})
    process.exit(process.exitCode ?? 0)
  })
