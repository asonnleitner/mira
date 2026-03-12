import type { SDKResultError } from '@anthropic-ai/claude-agent-sdk'
import type { SessionContext } from '~/agent/context-assembler'
import type { ToolContext } from '~/agent/tools'
import { resolve } from 'node:path'
import { ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_CONVERSATION_ID, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating'
import { assembleSystemPrompt } from '~/agent/context-assembler'
import { auditToolUse, createFileSecurityHook } from '~/agent/hooks'
import { createMcpTracingHooks } from '~/agent/mcp-tracing'
import { tracedQuery } from '~/agent/query'
import { createTherapyTools } from '~/agent/tools'
import { ANTHROPIC_MODEL_CLAUDE_SONNET, ATTR_BOT_PATIENT_ID, ATTR_BOT_SESSION_ID, ATTR_TELEGRAM_USER_ID } from '~/constants'
import { logger } from '~/telemetry/logger'

function createTherapistHooks(dataDir: string, sessionCtx: SessionContext) {
  const allowedBase = sessionCtx.sessionType === 'individual'
    ? resolve(dataDir, 'patients', String(sessionCtx.telegramId))
    : resolve(dataDir, 'couples', String(sessionCtx.chatId))

  const mcpTracing = createMcpTracingHooks()

  return {
    PreToolUse: [
      { matcher: '^(Read|Glob|Grep)$', hooks: [createFileSecurityHook(allowedBase, dataDir)] },
      { matcher: '^mcp__', hooks: [mcpTracing.preToolUse] },
    ],
    PostToolUse: [
      { matcher: '^(mcp__therapy-tools__|Read|Glob|Grep)', hooks: [auditToolUse] },
      { matcher: '^mcp__', hooks: [mcpTracing.postToolUse] },
    ],
    PostToolUseFailure: [
      { matcher: '^mcp__', hooks: [mcpTracing.postToolUseFailure] },
    ],
  }
}

export class StaleSessionError extends Error {
  constructor(public readonly sdkSessionId: string, public readonly errors: string[]) {
    super(`Stale SDK session: ${sdkSessionId}`)
    this.name = 'StaleSessionError'
  }
}

export function isStaleSessionError(err: unknown): boolean {
  if (err instanceof StaleSessionError)
    return true
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('No conversation found') || msg.includes('process exited with code 1')
}

const ALLOWED_TOOLS = [
  'mcp__therapy-tools__save_session_note',
  'mcp__therapy-tools__log_exercise',
  'mcp__therapy-tools__search_history',
  'Read',
  'Glob',
  'Grep',
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
    transcriptPath: sessionCtx.transcriptPath,
  }

  const tools = createTherapyTools(toolCtx)
  const systemPrompt = await assembleSystemPrompt(sessionCtx)
  const hooks = createTherapistHooks(sessionCtx.dataDir, sessionCtx)

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
        tools: ['Read', 'Glob', 'Grep'],
        maxTurns: 3,
        maxBudgetUsd: 5,
        cwd: sessionCtx.dataDir,
        persistSession: true,
        abortController,
        permissionMode: 'dontAsk',
        hooks,
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
    transcriptPath: sessionCtx.transcriptPath,
  }

  const tools = createTherapyTools(toolCtx)
  const systemPrompt = await assembleSystemPrompt(sessionCtx)
  const hooks = createTherapistHooks(sessionCtx.dataDir, sessionCtx)

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
        tools: ['Read', 'Glob', 'Grep'],
        maxTurns: 3,
        maxBudgetUsd: 5,
        cwd: sessionCtx.dataDir,
        abortController,
        permissionMode: 'dontAsk',
        hooks,
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
