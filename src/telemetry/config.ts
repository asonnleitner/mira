import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { config } from '~/config'

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.OTEL_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: config.OTEL_SERVICE_VERSION,
    'deployment.environment': config.ENVIRONMENT,
    'telemetry.sdk.language': 'javascript',
    'telemetry.sdk.runtime': 'bun',
  }),
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
})

sdk.start()
