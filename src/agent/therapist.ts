import type { SDKResultError, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import type { SessionContext } from '~/agent/context-assembler'
import type { ToolContext } from '~/agent/tools'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { SpanStatusCode } from '@opentelemetry/api'
import { ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_CONVERSATION_ID, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating'
import { assembleSystemPrompt } from '~/agent/context-assembler'
import { createTherapyTools } from '~/agent/tools'
import { MODELS } from '~/constants'
import { logger } from '~/telemetry/logger'
import { setGenAiContext, setGenAiResult, withGenAiSpan } from '~/telemetry/tracing'

export class StaleSessionError extends Error {
  constructor(public readonly sdkSessionId: string, public readonly errors: string[]) {
    super(`Stale SDK session: ${sdkSessionId}`)
    this.name = 'StaleSessionError'
  }
}

const ALLOWED_TOOLS = [
  'mcp__therapy-tools__save_session_note',
  'mcp__therapy-tools__update_profile',
  'mcp__therapy-tools__log_exercise',
  'mcp__therapy-tools__search_history',
]

export async function startTherapySession(
  sessionCtx: SessionContext,
  patientMessage: string,
  abortController?: AbortController,
): Promise<{ response: string, sdkSessionId: string }> {
  return withGenAiSpan(GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT, MODELS.SONNET, {
    [ATTR_GEN_AI_AGENT_NAME]: 'therapist',
    'bot.session_id': sessionCtx.sessionId,
    'bot.patient_id': sessionCtx.patientId,
    'telegram.user_id': sessionCtx.telegramId,
  }, async (span) => {
    const toolCtx: ToolContext = {
      sessionId: sessionCtx.sessionId,
      patientId: sessionCtx.patientId,
      telegramId: sessionCtx.telegramId,
      profilePath: sessionCtx.profilePath,
      transcriptPath: sessionCtx.transcriptPath,
    }

    const tools = createTherapyTools(toolCtx)
    const systemPrompt = await assembleSystemPrompt(sessionCtx)

    setGenAiContext(span, {
      systemPrompt,
      inputMessages: [{ role: 'user', content: patientMessage }],
      toolDefinitions: ALLOWED_TOOLS.map(name => ({ name })),
    })

    let response = ''
    let sdkSessionId = ''
    let resultMsg: SDKResultSuccess | undefined

    const q = query({
      prompt: patientMessage,
      options: {
        systemPrompt,
        model: MODELS.SONNET,
        mcpServers: { 'therapy-tools': tools },
        allowedTools: ALLOWED_TOOLS,
        tools: [],
        maxTurns: 3,
        maxBudgetUsd: 0.5,
        cwd: sessionCtx.dataDir,
        persistSession: true,
        abortController,
        permissionMode: 'acceptEdits',
        stderr: (data: string) => logger.warn('[therapist:stderr]', data),
      },
    })

    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        const failedServers = message.mcp_servers.filter(s => s.status !== 'connected' && s.name === 'therapy-tools')
        if (failedServers.length > 0) {
          logger.error('[therapist] MCP servers failed to connect:', failedServers)
        }
      }
      else if (message.type === 'result' && message.subtype === 'success') {
        response = message.result
        sdkSessionId = message.session_id
        resultMsg = message
      }
      else if (message.type === 'result') {
        const errorResult = message as SDKResultError
        logger.error('[therapist] SDK error result:', errorResult)
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorResult.errors.join('; ') })
        span.recordException(new Error(errorResult.errors.join('; ')))
        span.addEvent('sdk.error_result', {
          'sdk.error.subtype': errorResult.subtype,
          'sdk.error.messages': JSON.stringify(errorResult.errors),
        })
      }
    }

    span.setAttribute(ATTR_GEN_AI_CONVERSATION_ID, sdkSessionId)

    setGenAiResult(span, {
      outputMessages: [{ role: 'assistant', content: response }],
      inputTokens: resultMsg?.usage.input_tokens,
      outputTokens: resultMsg?.usage.output_tokens,
      cacheReadInputTokens: resultMsg?.usage.cache_read_input_tokens,
      cacheCreationInputTokens: resultMsg?.usage.cache_creation_input_tokens,
      totalCostUsd: resultMsg?.total_cost_usd,
      responseModel: MODELS.SONNET,
    })

    return { response, sdkSessionId }
  })
}

export async function continueTherapySession(
  sessionCtx: SessionContext,
  patientMessage: string,
  sdkSessionId: string,
  abortController?: AbortController,
): Promise<string> {
  return withGenAiSpan(GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT, MODELS.SONNET, {
    [ATTR_GEN_AI_AGENT_NAME]: 'therapist',
    [ATTR_GEN_AI_CONVERSATION_ID]: sdkSessionId,
    'bot.session_id': sessionCtx.sessionId,
    'bot.patient_id': sessionCtx.patientId,
    'telegram.user_id': sessionCtx.telegramId,
  }, async (span) => {
    const toolCtx: ToolContext = {
      sessionId: sessionCtx.sessionId,
      patientId: sessionCtx.patientId,
      telegramId: sessionCtx.telegramId,
      profilePath: sessionCtx.profilePath,
      transcriptPath: sessionCtx.transcriptPath,
    }

    const tools = createTherapyTools(toolCtx)
    const systemPrompt = await assembleSystemPrompt(sessionCtx)

    setGenAiContext(span, {
      systemPrompt,
      inputMessages: [{ role: 'user', content: patientMessage }],
      toolDefinitions: ALLOWED_TOOLS.map(name => ({ name })),
    })

    let response = ''
    let resultMsg: SDKResultSuccess | undefined

    const q = query({
      prompt: patientMessage,
      options: {
        resume: sdkSessionId,
        systemPrompt,
        model: MODELS.SONNET,
        mcpServers: { 'therapy-tools': tools },
        allowedTools: ALLOWED_TOOLS,
        tools: [],
        maxTurns: 3,
        maxBudgetUsd: 0.5,
        abortController,
        permissionMode: 'acceptEdits',
        stderr: (data: string) => logger.warn('[therapist:stderr]', data),
      },
    })

    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        const failedServers = message.mcp_servers.filter(s => s.status !== 'connected' && s.name === 'therapy-tools')
        if (failedServers.length > 0) {
          logger.error('[therapist] MCP servers failed to connect:', failedServers)
        }
      }
      else if (message.type === 'result' && message.subtype === 'success') {
        response = message.result
        resultMsg = message
      }
      else if (message.type === 'result') {
        const errorResult = message as SDKResultError
        logger.error('[therapist] SDK error result:', errorResult)
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorResult.errors.join('; ') })
        span.recordException(new Error(errorResult.errors.join('; ')))
        span.addEvent('sdk.error_result', {
          'sdk.error.subtype': errorResult.subtype,
          'sdk.error.messages': JSON.stringify(errorResult.errors),
        })

        const isStaleSession = errorResult.errors.some(e => e.includes('No conversation found'))
        if (isStaleSession) {
          throw new StaleSessionError(sdkSessionId, errorResult.errors)
        }
      }
    }

    setGenAiResult(span, {
      outputMessages: [{ role: 'assistant', content: response }],
      inputTokens: resultMsg?.usage.input_tokens,
      outputTokens: resultMsg?.usage.output_tokens,
      cacheReadInputTokens: resultMsg?.usage.cache_read_input_tokens,
      cacheCreationInputTokens: resultMsg?.usage.cache_creation_input_tokens,
      totalCostUsd: resultMsg?.total_cost_usd,
      responseModel: MODELS.SONNET,
    })

    return response
  })
}
