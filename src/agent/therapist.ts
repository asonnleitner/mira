import type { SessionContext } from '~/agent/context-assembler'
import type { ToolContext } from '~/agent/tools'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { assembleSystemPrompt } from '~/agent/context-assembler'
import { createTherapyTools } from '~/agent/tools'

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

  let response = ''
  let sdkSessionId = ''

  const q = query({
    prompt: patientMessage,
    options: {
      systemPrompt,
      model: 'claude-sonnet-4-6',
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

  return { response, sdkSessionId }
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

  let response = ''

  const q = query({
    prompt: patientMessage,
    options: {
      resume: sdkSessionId,
      systemPrompt,
      model: 'claude-sonnet-4-6',
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

  return response
}
