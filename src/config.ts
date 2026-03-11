import process from 'node:process'
import * as z from 'zod'

const envSchema = z.object({
  BOT_TOKEN: z.string(),
  ANTHROPIC_API_KEY: z.string(),
  DATABASE_URL: z.string(),
  DATA_DIR: z.string().default('./data'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format())
  process.exit(1)
}

export const config = parsed.data
