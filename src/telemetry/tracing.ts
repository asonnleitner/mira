import type { Attributes, Link, Span } from '@opentelemetry/api'
import type { Model } from '~/constants'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { ATTR_GEN_AI_INPUT_MESSAGES, ATTR_GEN_AI_OPERATION_NAME, ATTR_GEN_AI_OUTPUT_MESSAGES, ATTR_GEN_AI_PROVIDER_NAME, ATTR_GEN_AI_REQUEST_MODEL, ATTR_GEN_AI_SYSTEM_INSTRUCTIONS, ATTR_GEN_AI_TOOL_DEFINITIONS, ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, ATTR_GEN_AI_USAGE_INPUT_TOKENS, ATTR_GEN_AI_USAGE_OUTPUT_TOKENS, GEN_AI_PROVIDER_NAME_VALUE_ANTHROPIC } from '@opentelemetry/semantic-conventions/incubating'
import { config } from '~/config'

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
export type GenAiOperationNameValue = 'chat' | 'create_agent' | 'embeddings' | 'execute_tool' | 'generate_content' | 'invoke_agent' | 'retrieval' | 'text_completion'

export async function withGenAiSpan<T>(operationName: GenAiOperationNameValue, model: Model, attrs: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
  const spanName = `${operationName} ${model}`

  const genAiAttrs: Attributes = {
    [ATTR_GEN_AI_OPERATION_NAME]: operationName,
    [ATTR_GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_NAME_VALUE_ANTHROPIC,
    [ATTR_GEN_AI_REQUEST_MODEL]: model,
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

const captureContent = config.OTEL_CAPTURE_CONTENT

export function setGenAiContext(span: Span, opts: {
  systemPrompt: string
  inputMessages: { role: string, content: string }[]
  toolDefinitions: { name: string }[]
}): void {
  span.setAttribute(ATTR_GEN_AI_TOOL_DEFINITIONS, JSON.stringify(opts.toolDefinitions))

  if (captureContent) {
    span.setAttribute(ATTR_GEN_AI_SYSTEM_INSTRUCTIONS, JSON.stringify(opts.systemPrompt))
    span.setAttribute(ATTR_GEN_AI_INPUT_MESSAGES, JSON.stringify(opts.inputMessages))
  }
}

export function setGenAiResult(span: Span, data: {
  outputMessages?: { role: string, content: string }[]
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  totalCostUsd?: number
  responseModel?: string
}): void {
  if (data.inputTokens != null)
    span.setAttribute(ATTR_GEN_AI_USAGE_INPUT_TOKENS, data.inputTokens)
  if (data.outputTokens != null)
    span.setAttribute(ATTR_GEN_AI_USAGE_OUTPUT_TOKENS, data.outputTokens)
  if (data.cacheReadInputTokens != null)
    span.setAttribute(ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, data.cacheReadInputTokens)
  if (data.cacheCreationInputTokens != null)
    span.setAttribute(ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, data.cacheCreationInputTokens)
  if (data.responseModel != null)
    span.setAttribute('gen_ai.response.model', data.responseModel)
  if (data.totalCostUsd != null)
    span.setAttribute('gen_ai.usage.cost', data.totalCostUsd)

  if (captureContent && data.outputMessages) {
    span.setAttribute(ATTR_GEN_AI_OUTPUT_MESSAGES, JSON.stringify(data.outputMessages))
  }
}
