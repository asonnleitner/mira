import type { SDKResultError } from '@anthropic-ai/claude-agent-sdk'
import type { SessionContext } from '~/agent/context-assembler'
import type { ToolContext } from '~/agent/tools'
import { ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_CONVERSATION_ID, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating'
import { assembleSystemPrompt } from '~/agent/context-assembler'
import { tracedQuery } from '~/agent/query'
import { createTherapyTools } from '~/agent/tools'
import { ANTHROPIC_MODEL_CLAUDE_SONNET, ATTR_BOT_PATIENT_ID, ATTR_BOT_SESSION_ID, ATTR_TELEGRAM_USER_ID } from '~/constants'
import { logger } from '~/telemetry/logger'

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
  const toolCtx: ToolContext = {
    sessionId: sessionCtx.sessionId,
    patientId: sessionCtx.patientId,
    telegramId: sessionCtx.telegramId,
    profilePath: sessionCtx.profilePath,
    transcriptPath: sessionCtx.transcriptPath,
  }

  const tools = createTherapyTools(toolCtx)
  const systemPrompt = await assembleSystemPrompt(sessionCtx)

  const { response, sessionId } = await tracedQuery(
    {
      operationName: GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
      label: 'therapist',
      attributes: {
        [ATTR_GEN_AI_AGENT_NAME]: 'therapist',
        'bot.session_id': sessionCtx.sessionId,
        [ATTR_BOT_PATIENT_ID]: sessionCtx.patientId,
        [ATTR_TELEGRAM_USER_ID]: sessionCtx.telegramId,
      },
    },
    {
      prompt: patientMessage,
      options: {
        systemPrompt,
        model: ANTHROPIC_MODEL_CLAUDE_SONNET,
        mcpServers: { 'therapy-tools': tools },
        allowedTools: ALLOWED_TOOLS,
        tools: [],
        maxTurns: 3,
        maxBudgetUsd: 5,
        cwd: sessionCtx.dataDir,
        persistSession: true,
        abortController,
        permissionMode: 'acceptEdits',
        stderr: (data: string) => logger.warn('[therapist:stderr]', data),
      },
    },
    {
      onSuccess: (result, span) => {
        span.setAttribute(ATTR_GEN_AI_CONVERSATION_ID, result.sessionId)
      },
    },
  )

  return { response, sdkSessionId: sessionId }
}

export async function continueTherapySession(
  sessionCtx: SessionContext,
  patientMessage: string,
  sdkSessionId: string,
  abortController?: AbortController,
): Promise<string> {
  const toolCtx: ToolContext = {
    sessionId: sessionCtx.sessionId,
    patientId: sessionCtx.patientId,
    telegramId: sessionCtx.telegramId,
    profilePath: sessionCtx.profilePath,
    transcriptPath: sessionCtx.transcriptPath,
  }

  const tools = createTherapyTools(toolCtx)
  const systemPrompt = await assembleSystemPrompt(sessionCtx)

  const { response } = await tracedQuery(
    {
      operationName: GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
      label: 'therapist',
      attributes: {
        [ATTR_GEN_AI_AGENT_NAME]: 'therapist',
        [ATTR_GEN_AI_CONVERSATION_ID]: sdkSessionId,
        [ATTR_BOT_SESSION_ID]: sessionCtx.sessionId,
        [ATTR_BOT_PATIENT_ID]: sessionCtx.patientId,
        [ATTR_TELEGRAM_USER_ID]: sessionCtx.telegramId,
      },
    },
    {
      prompt: patientMessage,
      options: {
        resume: sdkSessionId,
        systemPrompt,
        model: ANTHROPIC_MODEL_CLAUDE_SONNET,
        mcpServers: { 'therapy-tools': tools },
        allowedTools: ALLOWED_TOOLS,
        tools: [],
        maxTurns: 3,
        maxBudgetUsd: 5,
        abortController,
        permissionMode: 'acceptEdits',
        stderr: (data: string) => logger.warn('[therapist:stderr]', data),
      },
    },
    {
      onError: (errorResult: SDKResultError) => {
        const isStaleSession = errorResult.errors.some(e => e.includes('No conversation found'))
        if (isStaleSession) {
          throw new StaleSessionError(sdkSessionId, errorResult.errors)
        }
      },
    },
  )

  return response
}
