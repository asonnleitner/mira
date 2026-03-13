import type { SessionContext } from '~/agent/context-assembler'
import { resolve } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ATTR_GEN_AI_AGENT_NAME, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating'
import * as z from 'zod'
import { auditToolUse, createFileSecurityHook } from '~/agent/hooks'
import { createMcpTracingHooks } from '~/agent/mcp-tracing'
import { tracedQuery } from '~/agent/query'
import { ANTHROPIC_MODEL_CLAUDE_SONNET, ATTR_BOT_SESSION_ID } from '~/constants'
import { saveArtifact } from '~/db/queries/artifacts'
import { artifactTypeValues } from '~/db/schema'
import { logger } from '~/telemetry/logger'

const NOTE_TAKER_SYSTEM_PROMPT = `You are a clinical documentation assistant reviewing a therapy exchange between Mira (therapist) and a patient.

Your responsibilities:
1. Read the patient's current profile (PROFILE.md)
2. Determine if this exchange contains clinically significant information
3. If yes: update PROFILE.md with new observations, themes, patterns, or progress notes
4. Save specific artifacts (disclosures, insights, emotional moments, homework, risk factors, strengths) using save_artifact
5. If enough material has accumulated since the last summary, write a brief session summary

Guidelines for PROFILE.md:
- Evolve the document structure organically
- Write as a clinician would — precise, professional, but capture nuance
- Don't rewrite the entire file — read it first, then make targeted updates
- Add new sections as needed (e.g., "Risk Assessment", "Treatment Progress", "Key Relationships")
- Update existing sections when new information refines understanding
- Include dates on progress entries

Guidelines for artifacts:
- Save only genuinely significant observations
- Include verbatim quotes when the patient's exact words matter
- Rate clinical relevance honestly (1-10)
- When the patient describes self-harm, eating disorder behaviors, substance use concerns, or domestic violence indicators, save as risk_factor with high clinical relevance (8-10)
- When the patient demonstrates resilience, identifies resources, or describes exceptions to problems, save as strength

Guidelines for summaries:
- Write a summary when the exchange represents a meaningful therapeutic moment
- Append under a "## Session Notes" section in PROFILE.md with a date
- Format as a brief clinical note (2-4 sentences), not a full SOAP note

Not every exchange warrants updates. Routine pleasantries or brief check-ins may need no documentation.`

function createNoteTakerTools(ctx: SessionContext) {
  return createSdkMcpServer({
    name: 'note-taker-tools',
    version: '1.0.0',
    tools: [
      tool(
        'save_artifact',
        'Save a clinically significant artifact from the therapy exchange.',
        {
          type: z.enum(artifactTypeValues),
          content: z.string().describe('Description of the clinical observation'),
          verbatimQuote: z.string().optional().describe('Exact quote from the patient, if relevant'),
          clinicalRelevance: z.number().min(1).max(10).describe('Clinical relevance score 1-10'),
        },
        async (args) => {
          await saveArtifact({
            sessionId: ctx.sessionId,
            patientId: ctx.patientId,
            type: args.type,
            content: args.content,
            verbatimQuote: args.verbatimQuote,
            clinicalRelevance: args.clinicalRelevance,
          })
          logger.debug(`[note-taker] Saved artifact: type=${args.type} relevance=${args.clinicalRelevance}`)
          return {
            content: [{ type: 'text' as const, text: `Artifact saved: ${args.type}` }],
          }
        },
        { annotations: { readOnlyHint: false } },
      ),
    ],
  })
}

function createNoteTakerHooks(dataDir: string, ctx: SessionContext) {
  const allowedBase = ctx.sessionType === 'individual'
    ? resolve(dataDir, 'patients', String(ctx.telegramId))
    : resolve(dataDir, 'couples', String(ctx.chatId))

  const mcpTracing = createMcpTracingHooks()

  return {
    PreToolUse: [
      { matcher: '^(Read|Write)$', hooks: [createFileSecurityHook(allowedBase, dataDir)] },
      { matcher: '^mcp__', hooks: [mcpTracing.preToolUse] },
    ],
    PostToolUse: [
      { matcher: '^(mcp__note-taker-tools__|Read|Write)', hooks: [auditToolUse] },
      { matcher: '^mcp__', hooks: [mcpTracing.postToolUse] },
    ],
    PostToolUseFailure: [
      { matcher: '^mcp__', hooks: [mcpTracing.postToolUseFailure] },
    ],
  }
}

function buildNoteTakerPrompt(
  patientMessage: string,
  therapistResponse: string,
  ctx: SessionContext,
): string {
  const profilePath = ctx.sessionType === 'individual'
    ? `patients/${ctx.telegramId}/PROFILE.md`
    : `couples/${ctx.chatId}/RELATIONSHIP.md`

  return `Review this therapy exchange and update clinical documentation as needed.

Patient message:
"""
${patientMessage}
"""

Therapist response:
"""
${therapistResponse}
"""

Session type: ${ctx.sessionType}

The patient's profile is at: ${profilePath}
Read it first, then decide what updates (if any) are warranted.`
}

export async function runNoteTaker(
  ctx: SessionContext,
  patientMessage: string,
  therapistResponse: string,
): Promise<void> {
  try {
    logger.debug(`[note-taker] Starting for session ${ctx.sessionId} (${ctx.sessionType})`)

    const mcpTools = createNoteTakerTools(ctx)
    const hooks = createNoteTakerHooks(ctx.dataDir, ctx)

    await tracedQuery(
      {
        operationName: GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
        label: 'note-taker',
        attributes: {
          [ATTR_GEN_AI_AGENT_NAME]: 'note-taker',
          [ATTR_BOT_SESSION_ID]: ctx.sessionId,
        },
      },
      {
        prompt: buildNoteTakerPrompt(patientMessage, therapistResponse, ctx),
        options: {
          systemPrompt: NOTE_TAKER_SYSTEM_PROMPT,
          model: ANTHROPIC_MODEL_CLAUDE_SONNET,
          mcpServers: { 'note-taker-tools': mcpTools },
          allowedTools: [
            'mcp__note-taker-tools__save_artifact',
            'Read',
            'Write',
          ],
          tools: ['Read', 'Write'],
          maxTurns: 5,
          maxBudgetUsd: 2,
          cwd: ctx.dataDir,
          persistSession: false,
          permissionMode: 'dontAsk',
          hooks,
          stderr: (data: string) => logger.warn('[note-taker:stderr]', data),
        },
      },
    )

    logger.debug(`[note-taker] Completed for session ${ctx.sessionId}`)
  }
  catch (err) {
    logger.error('Note-taker failed:', err)
  }
}
