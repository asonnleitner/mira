import process from 'node:process'
import * as z from 'zod'

const envSchema = z.object({
  BOT_TOKEN: z.string(),
  ANTHROPIC_API_KEY: z.string(),
  DATABASE_URL: z.string().default('sqlite.db'),
  DATA_DIR: z.string().default('./data'),
  OTEL_SERVICE_NAME: z.string().default('mira-bot'),
  OTEL_SERVICE_VERSION: z.string().default('1.0.0'),
  OTEL_CAPTURE_CONTENT: z.coerce.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  ENVIRONMENT: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),
  PORT: z.coerce.number().default(3000),
  CHECKIN_INTERVAL_MINUTES: z.coerce.number().default(15),
  CHECKIN_DEFAULT_DAYS: z.coerce.number().default(3),
  CHECKIN_WINDOW_START: z.coerce.number().default(9),
  CHECKIN_WINDOW_END: z.coerce.number().default(20),
  CHECKIN_TIMEZONE: z.string().default('Europe/Prague'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', z.treeifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
