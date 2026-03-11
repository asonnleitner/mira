import process from 'node:process'
import * as z from 'zod'

const envSchema = z.object({
  BOT_TOKEN: z.string(),
  ANTHROPIC_API_KEY: z.string(),
  DATA_DIR: z.string().default('./data'),
  POSTGRES_DB: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PORT: z.string(),
  POSTGRES_HOST: z.string(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', z.treeifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
