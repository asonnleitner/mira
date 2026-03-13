import type { PromptContext } from '~/agent/system-prompt'
import type { SessionType } from '~/db/schema'
import { buildSystemPrompt } from '~/agent/system-prompt'
import { ATTR_TELEGRAM_USER_ID } from '~/constants'
import { getArtifactsByPatient } from '~/db/queries/artifacts'
import { readProfile } from '~/storage/profile'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

export interface SessionContext {
  sessionId: number
  sessionType: SessionType
  chatId: number
  patientId: number
  telegramId: number
  preferredLanguage?: string
  sdkSessionId?: string
  transcriptPath: string
  profilePath: string
  dataDir: string
}

export async function assembleSystemPrompt(
  ctx: SessionContext,
): Promise<string> {
  return withSpan('agent.assembleSystemPrompt', { [ATTR_TELEGRAM_USER_ID]: ctx.telegramId }, async (span) => {
    const promptCtx: PromptContext = {
      sessionType: ctx.sessionType,
      telegramId: ctx.telegramId,
      preferredLanguage: ctx.preferredLanguage,
    }

    // Load profile based on session type
    if (ctx.sessionType === 'couples') {
      // Only load relationship profile — individual profiles are private
      const relContent = await readProfile(ctx.profilePath)
      if (relContent) {
        promptCtx.relationshipProfile = relContent
        logger.debug(`[context-assembler] Loaded relationship profile for chat ${ctx.chatId}`)
      }
      else {
        logger.debug(`[context-assembler] No relationship profile found at ${ctx.profilePath}`)
      }
    }
    else {
      // Load individual patient profile
      const profileContent = await readProfile(ctx.profilePath)
      if (profileContent) {
        promptCtx.patientProfile = profileContent
        logger.debug(`[context-assembler] Loaded patient profile for user ${ctx.telegramId}`)
      }
      else {
        logger.debug(`[context-assembler] No patient profile found at ${ctx.profilePath}`)
      }
    }

    // Load relevant artifacts (last 20, highest relevance)
    const artifacts = await getArtifactsByPatient(ctx.patientId)
    span.setAttribute('agent.artifact_count', artifacts.length)
    logger.debug(`[context-assembler] Loaded ${artifacts.length} artifacts for patient ${ctx.patientId}`)

    if (artifacts.length > 0) {
      const topArtifacts = artifacts
        .sort(
          (a, b) =>
            (b.clinicalRelevance ?? 5) - (a.clinicalRelevance ?? 5),
        )
        .slice(0, 20)

      promptCtx.relevantArtifacts = topArtifacts
        .map(
          a =>
            `- [${a.type}] ${a.content}${a.verbatimQuote ? ` (Quote: "${a.verbatimQuote}")` : ''}`,
        )
        .join('\n')
    }

    const prompt = buildSystemPrompt(promptCtx)
    span.setAttribute('agent.prompt_length', prompt.length)

    return prompt
  })
}
