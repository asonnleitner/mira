import { createConsola } from 'consola'
import { config } from '~/config'

const levelMap: Record<string, number> = {
  fatal: 0,
  error: 0,
  warn: 1,
  log: 2,
  info: 3,
  debug: 4,
  trace: 5,
  verbose: 5,
}

export const logger = createConsola({
  level: levelMap[config.LOG_LEVEL] ?? 3,
})
