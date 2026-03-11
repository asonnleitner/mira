import type { PromptContext } from '~/agent/system-prompt'
import { join } from 'node:path'
import { buildSystemPrompt } from '~/agent/system-prompt'
import { config } from '~/config'
import { getArtifactsByPatient } from '~/db/queries/artifacts'
import { readProfile } from '~/storage/profile'

export interface SessionContext {
  sessionId: number
  sessionType: 'individual' | 'couples'
  chatId: number
  patientId: number
  telegramId: number
  sdkSessionId?: string
  transcriptPath: string
  profilePath: string
  dataDir: string
}

export async function assembleSystemPrompt(
  ctx: SessionContext,
): Promise<string> {
  const promptCtx: PromptContext = {
    sessionType: ctx.sessionType,
  }

  // Load patient profile
  const profileContent = await readProfile(ctx.profilePath)
  if (profileContent) {
    promptCtx.patientProfile = profileContent
  }

  // Load relationship profile for couples
  if (ctx.sessionType === 'couples') {
    const relationshipPath = join(
      config.DATA_DIR,
      'couples',
      String(ctx.chatId),
      'RELATIONSHIP.md',
    )
    const relContent = await readProfile(relationshipPath)
    if (relContent) {
      promptCtx.relationshipProfile = relContent
    }
  }

  // Load relevant artifacts (last 20, highest relevance)
  const artifacts = await getArtifactsByPatient(ctx.patientId)
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

  return buildSystemPrompt(promptCtx)
}
