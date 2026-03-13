import type { ConsolaReporter, LogObject } from 'consola'
import { context } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
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

const severityMap: Record<string, SeverityNumber> = {
  fatal: SeverityNumber.FATAL,
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  log: SeverityNumber.INFO,
  info: SeverityNumber.INFO,
  debug: SeverityNumber.DEBUG,
  trace: SeverityNumber.TRACE,
  verbose: SeverityNumber.TRACE,
}

const otelBridge: ConsolaReporter = {
  log(logObj: LogObject) {
    const otelLogger = logs.getLogger('mira')
    const body = logObj.args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    otelLogger.emit({
      severityNumber: severityMap[logObj.type] ?? SeverityNumber.INFO,
      severityText: logObj.type.toUpperCase(),
      body,
      context: context.active(),
      attributes: {
        ...(logObj.tag ? { 'log.tag': logObj.tag } : {}),
      },
    })
  },
}

export const logger = createConsola({
  level: levelMap[config.LOG_LEVEL] ?? 3,
})

logger.addReporter(otelBridge)
