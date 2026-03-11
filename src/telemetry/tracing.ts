import type { Attributes, Link, Span } from '@opentelemetry/api'
import type { Model } from '~/constants'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('therapy-bot')

export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    }
    catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      span.recordException(err as Error)
      throw err
    }
    finally {
      span.end()
    }
  })
}

export async function withLinkedSpan<T>(
  name: string,
  attrs: Attributes,
  links: Link[],
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs, links }, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    }
    catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      span.recordException(err as Error)
      throw err
    }
    finally {
      span.end()
    }
  })
}

export function captureSpanContext() {
  return trace.getActiveSpan()?.spanContext()
}

export async function withGenAiSpan<T>(operationName: string, model: Model, attrs: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
  const spanName = `${operationName} ${model}`

  const genAiAttrs: Attributes = {
    'gen_ai.operation.name': operationName,
    'gen_ai.provider.name': 'anthropic',
    'gen_ai.request.model': model,
    ...attrs,
  }

  return tracer.startActiveSpan(spanName, {
    kind: SpanKind.CLIENT,
    attributes: genAiAttrs,
  }, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    }
    catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      span.recordException(err as Error)
      throw err
    }
    finally {
      span.end()
    }
  })
}
