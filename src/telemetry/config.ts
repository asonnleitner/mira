import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_TELEMETRY_SDK_LANGUAGE } from '@opentelemetry/semantic-conventions'
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating'
import { config } from '~/config'
import { logger } from '~/telemetry/logger'

const endpoint = config.OTEL_EXPORTER_OTLP_ENDPOINT

function parseOtlpHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw)
    return undefined
  const headers: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx > 0)
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }
  return headers
}

const headers = parseOtlpHeaders(config.OTEL_EXPORTER_OTLP_HEADERS)

const spanProcessor = endpoint
  ? (() => {
      logger.info(`OTLP trace exporter configured: ${endpoint}`)
      return new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }))
    })()
  : (() => {
      logger.info('No OTLP endpoint configured, using console span exporter')
      return new SimpleSpanProcessor(new ConsoleSpanExporter())
    })()

export const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.OTEL_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: config.OTEL_SERVICE_VERSION,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.ENVIRONMENT,
    [ATTR_TELEMETRY_SDK_LANGUAGE]: 'javascript',
    'telemetry.sdk.runtime': 'bun',
  }),
  spanProcessors: [spanProcessor],
})

sdk.start()
