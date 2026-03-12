import type { Attributes, Link, Span } from '@opentelemetry/api'
import type { AnthropicModel } from '~/constants'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { ATTR_DB_COLLECTION_NAME, ATTR_DB_NAMESPACE, ATTR_DB_OPERATION_NAME, ATTR_DB_QUERY_SUMMARY, ATTR_DB_QUERY_TEXT, ATTR_DB_SYSTEM_NAME, ATTR_ERROR_TYPE } from '@opentelemetry/semantic-conventions'
import { ATTR_GEN_AI_INPUT_MESSAGES, ATTR_GEN_AI_OPERATION_NAME, ATTR_GEN_AI_OUTPUT_MESSAGES, ATTR_GEN_AI_PROVIDER_NAME, ATTR_GEN_AI_REQUEST_MODEL, ATTR_GEN_AI_RESPONSE_MODEL, ATTR_GEN_AI_SYSTEM_INSTRUCTIONS, ATTR_GEN_AI_TOOL_DEFINITIONS, ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, ATTR_GEN_AI_USAGE_INPUT_TOKENS, ATTR_GEN_AI_USAGE_OUTPUT_TOKENS, DB_SYSTEM_NAME_VALUE_SQLITE, GEN_AI_PROVIDER_NAME_VALUE_ANTHROPIC } from '@opentelemetry/semantic-conventions/incubating'
import { config } from '~/config'

const tracer = trace.getTracer('mira')

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

export async function withGenAiSpan<T>(operationName: GenAiOperationNameValue, model: AnthropicModel, attrs: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
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
    span.setAttribute(ATTR_GEN_AI_RESPONSE_MODEL, data.responseModel)

  if (data.totalCostUsd != null)
    span.setAttribute('gen_ai.usage.cost', data.totalCostUsd)

  if (captureContent && data.outputMessages) {
    span.setAttribute(ATTR_GEN_AI_OUTPUT_MESSAGES, JSON.stringify(data.outputMessages))
  }
}

const RE_OPERATION = /^\s*(\w+)/
const RE_INTO = /into\s+"?(\w+)"?/i
const RE_UPDATE = /update\s+"?(\w+)"?/i
const RE_FROM = /from\s+"?(\w+)"?/i

function parseSql(sql: string): { operation: string, collection: string } {
  const operation = sql.match(RE_OPERATION)?.[1]?.toUpperCase() ?? 'UNKNOWN'
  let collection: string | undefined
  if (operation === 'INSERT')
    collection = sql.match(RE_INTO)?.[1]
  else if (operation === 'UPDATE')
    collection = sql.match(RE_UPDATE)?.[1]
  else
    collection = sql.match(RE_FROM)?.[1]
  return { operation, collection: collection ?? 'unknown' }
}

interface DrizzleQuery<T> {
  toSQL: () => { sql: string, params: unknown[] }
  then: PromiseLike<T>['then']
}

export async function withDbSpan<T>(
  query: DrizzleQuery<T>,
): Promise<T> {
  const { sql: queryText } = query.toSQL()
  const { operation, collection } = parseSql(queryText)
  const spanName = `${operation} ${collection}`

  const attrs: Attributes = {
    [ATTR_DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_SQLITE,
    [ATTR_DB_OPERATION_NAME]: operation,
    [ATTR_DB_COLLECTION_NAME]: collection,
    [ATTR_DB_NAMESPACE]: config.DATABASE_URL,
    [ATTR_DB_QUERY_SUMMARY]: spanName,
  }

  if (captureContent) {
    attrs[ATTR_DB_QUERY_TEXT] = queryText
  }

  return tracer.startActiveSpan(spanName, {
    kind: SpanKind.CLIENT,
    attributes: attrs,
  }, async (span) => {
    try {
      const result = await (query as PromiseLike<T>)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    }
    catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      span.setAttribute(ATTR_ERROR_TYPE, (err as Error).constructor?.name ?? 'Error')
      span.recordException(err as Error)
      throw err
    }
    finally {
      span.end()
    }
  })
}
