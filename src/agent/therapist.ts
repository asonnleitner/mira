import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import type { SessionContext } from '~/agent/context-assembler'
import type { ToolContext } from '~/agent/tools'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { assembleSystemPrompt } from '~/agent/context-assembler'
import { createTherapyTools } from '~/agent/tools'
import { MODELS } from '~/constants'
import { logger } from '~/telemetry/logger'
import { setGenAiContext, setGenAiResult, withGenAiSpan } from '~/telemetry/tracing'

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
  return withGenAiSpan('invoke_agent', MODELS.SONNET, {
    'gen_ai.agent.name': 'therapist',
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
        const failedServers = message.mcp_servers.filter(s => s.status !== 'connected')
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
        logger.error('[therapist] SDK error result:', message)
      }
    }

    span.setAttribute('gen_ai.conversation.id', sdkSessionId)

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
  return withGenAiSpan('invoke_agent', MODELS.SONNET, {
    'gen_ai.agent.name': 'therapist',
    'gen_ai.conversation.id': sdkSessionId,
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
        const failedServers = message.mcp_servers.filter(s => s.status !== 'connected')
        if (failedServers.length > 0) {
          logger.error('[therapist] MCP servers failed to connect:', failedServers)
        }
      }
      else if (message.type === 'result' && message.subtype === 'success') {
        response = message.result
        resultMsg = message
      }
      else if (message.type === 'result') {
        logger.error('[therapist] SDK error result:', message)
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
