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

const tagPattern = /^\[([^\]]+)\] ?(.+)?$/

const tagExtractor: ConsolaReporter = {
  log(logObj: LogObject) {
    if (typeof logObj.args[0] === 'string') {
      const match = tagPattern.exec(logObj.args[0])
      if (match) {
        logObj.tag = match[1]
        if (match[2]) {
          logObj.args[0] = match[2]
        }
        else {
          logObj.args.shift()
        }
      }
    }
  },
}

const otelBridge: ConsolaReporter = {
  log(logObj: LogObject) {
    const otelLogger = logs.getLogger('mira')
    const body = logObj.args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')

    otelLogger.emit({
      timestamp: logObj.date,
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

const timestampReporter: ConsolaReporter = {
  log(logObj: LogObject) {
    const d = logObj.date
    const ts = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    logObj.args.unshift(ts)
  },
}

export const logger = createConsola({
  level: levelMap[config.LOG_LEVEL] ?? 3,
})

const defaultReporter = logger.options.reporters[0]
logger.setReporters([tagExtractor, otelBridge, timestampReporter, defaultReporter])
