import type { Options, SDKMessage, SDKResultError, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import type { Attributes, Span } from '@opentelemetry/api'
import type { AnthropicModel } from '~/constants'
import type { GenAiOperationNameValue } from '~/telemetry/tracing'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { SpanStatusCode } from '@opentelemetry/api'
import { ATTR_ERROR_TYPE, ATTR_SERVER_ADDRESS } from '@opentelemetry/semantic-conventions'
import { logger } from '~/telemetry/logger'
import { setGenAiContext, setGenAiResult, withGenAiSpan } from '~/telemetry/tracing'

function isResultError(msg: SDKMessage): msg is SDKResultError {
  return msg.type === 'result' && msg.subtype !== 'success'
}

interface TracedQuerySpan {
  operationName: GenAiOperationNameValue
  label: string
  attributes?: Attributes
}

interface TracedQueryCallbacks {
  onError?: (error: SDKResultError) => void
  onSuccess?: (result: TracedQueryResult, span: Span) => void
}

export interface TracedQueryResult {
  response: string
  structuredOutput: unknown
  sessionId: string
  resultMessage?: SDKResultSuccess
}

export async function tracedQuery(
  trace: TracedQuerySpan,
  params: { prompt: string, options: Options },
  callbacks?: TracedQueryCallbacks,
): Promise<TracedQueryResult> {
  const { operationName, label, attributes = {} } = trace
  const { prompt, options } = params

  const model = options.model as AnthropicModel
  const systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : ''
  const toolDefinitions = (options.allowedTools ?? []).map(name => ({ name }))

  return withGenAiSpan(operationName, model, attributes, async (span) => {
    setGenAiContext(span, {
      systemPrompt,
      inputMessages: [{ role: 'user', content: prompt }],
      toolDefinitions,
    })

    const ownServers = new Set(Object.keys(options.mcpServers ?? {}))
    let result: TracedQueryResult = { response: '', structuredOutput: null, sessionId: '' }
    let messageCount = 0

    const q = query({ prompt, options })

    for await (const message of q) {
      messageCount++

      if (message.type === 'system' && message.subtype === 'init') {
        if (ownServers.size > 0) {
          const failed = message.mcp_servers.filter(s => s.status !== 'connected' && ownServers.has(s.name))

          for (const server of failed) {
            logger.error(`[${label}] MCP server failed to connect: ${server.name} (${server.status})`)

            span.addEvent('mcp.server.connection_error', {
              [ATTR_SERVER_ADDRESS]: server.name,
              [ATTR_ERROR_TYPE]: server.status,
            })
          }
        }
      }
      else if (message.type === 'result' && message.subtype === 'success') {
        result = {
          response: message.result,
          structuredOutput: message.structured_output,
          sessionId: message.session_id,
          resultMessage: message,
        }
      }
      else if (isResultError(message)) {
        logger.error(`[${label}] SDK error result:`, message)

        span.setStatus({ code: SpanStatusCode.ERROR, message: message.errors.join('; ') })
        span.recordException(new Error(message.errors.join('; ')))
        span.addEvent('sdk.error_result', {
          'sdk.error.subtype': message.subtype,
          'sdk.error.messages': JSON.stringify(message.errors),
        })

        callbacks?.onError?.(message)
      }
      else if (message.type === 'rate_limit_event') {
        const { status, rateLimitType, utilization } = message.rate_limit_info

        if (status !== 'allowed') {
          logger.warn(`[${label}] Rate limit ${status}`, { rateLimitType, utilization })
          span.addEvent('gen_ai.rate_limit', {
            'rate_limit.status': status,
            'rate_limit.type': rateLimitType ?? 'unknown',
            'rate_limit.utilization': utilization ?? 0,
          })
        }
      }
      else if (message.type === 'assistant' && message.error) {
        logger.warn(`[${label}] Assistant message error: ${message.error}`)

        span.addEvent('gen_ai.assistant_error', {
          [ATTR_ERROR_TYPE]: message.error,
        })
      }
      else {
        logger.debug(`[${label}] SDK message:`, { type: message.type, subtype: 'subtype' in message ? message.subtype : undefined })
      }
    }

    if (!result.resultMessage) {
      logger.warn(`[${label}] Agent query completed without a result message (${messageCount} messages received)`)

      span.addEvent('sdk.no_result', { 'sdk.message_count': messageCount })
    }

    const msg = result.resultMessage

    setGenAiResult(span, {
      outputMessages: [{ role: 'assistant', content: result.response || JSON.stringify(result.structuredOutput) }],
      inputTokens: msg?.usage.input_tokens,
      outputTokens: msg?.usage.output_tokens,
      cacheReadInputTokens: msg?.usage.cache_read_input_tokens,
      cacheCreationInputTokens: msg?.usage.cache_creation_input_tokens,
      totalCostUsd: msg?.total_cost_usd,
      responseModel: model,
    })

    if (result.resultMessage)
      callbacks?.onSuccess?.(result, span)

    return result
  })
}
