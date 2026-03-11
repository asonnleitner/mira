import type { SessionContext } from '~/agent/context-assembler'
import type { ToolContext } from '~/agent/tools'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { assembleSystemPrompt } from '~/agent/context-assembler'
import { createTherapyTools } from '~/agent/tools'
import { MODELS } from '~/constants'
import { withGenAiSpan } from '~/telemetry/tracing'

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

    let response = ''
    let sdkSessionId = ''

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
      },
    })

    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success') {
        response = message.result
        sdkSessionId = message.session_id
      }
    }

    span.setAttribute('gen_ai.conversation.id', sdkSessionId)
    span.setAttribute('gen_ai.response.model', MODELS.SONNET)

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

    let response = ''

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
      },
    })

    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success') {
        response = message.result
      }
    }

    span.setAttribute('gen_ai.response.model', MODELS.SONNET)

    return response
  })
}
