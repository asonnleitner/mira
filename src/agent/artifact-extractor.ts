import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import type { SessionContext } from '~/agent/context-assembler'
import type { PatientProfile } from '~/db/schema'
import { dirname, join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'
import { MODELS } from '~/constants'
import { saveArtifact } from '~/db/queries/artifacts'
import { updatePatientProfile } from '~/db/queries/patients'
import { artifactTypeValues } from '~/db/schema'
import { soapSchema } from '~/db/zod'
import { readProfile, writeProfile } from '~/storage/profile'
import { writeSoapNote } from '~/storage/soap-notes'
import { logger } from '~/telemetry/logger'
import { setGenAiContext, setGenAiResult, withGenAiSpan } from '~/telemetry/tracing'

const ArtifactSchema = z.object({
  artifacts: z.array(
    z.object({
      type: z.enum(artifactTypeValues),
      content: z.string(),
      verbatimQuote: z.string().optional(),
      clinicalRelevance: z.number().min(1).max(10),
    }),
  ),
  profileUpdates: z.object({
    newThemes: z.array(z.string()).optional(),
    newTriggers: z.array(z.string()).optional(),
    progressNote: z.string().optional(),
    riskLevelChange: z.enum(['none', 'increased', 'decreased']).optional(),
  }),
  shouldGenerateSoapNote: z.boolean(),
})

export async function extractArtifacts(
  ctx: SessionContext,
  patientMessage: string,
  therapistResponse: string,
): Promise<void> {
  await withGenAiSpan('chat', MODELS.HAIKU, {
    'gen_ai.output.type': 'json',
    'bot.session_id': ctx.sessionId,
  }, async (span) => {
    try {
      const prompt = `Analyze this therapy exchange and extract clinical artifacts.

Patient message:
"""
${patientMessage}
"""

Therapist response:
"""
${therapistResponse}
"""

Extract any clinically significant artifacts (disclosures, insights, emotions, patterns, etc.).
Also identify any profile updates needed and whether a SOAP note should be generated (only if this feels like a natural session ending point).`

      const systemPrompt = 'You are a clinical note-taking assistant. Extract therapy artifacts from the exchange. Be precise and clinical. Only extract genuinely significant items — not every message warrants artifacts.'

      setGenAiContext(span, {
        systemPrompt,
        inputMessages: [{ role: 'user', content: prompt }],
        toolDefinitions: [],
      })

      let result: unknown = null
      let resultMsg: SDKResultSuccess | undefined

      const q = query({
        prompt,
        options: {
          systemPrompt,
          model: MODELS.HAIKU,
          tools: [],
          maxTurns: 1,
          maxBudgetUsd: 0.02,
          persistSession: false,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          outputFormat: {
            type: 'json_schema',
            schema: z.toJSONSchema(ArtifactSchema),
          },
        },
      })

      for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
          result = message.structured_output
          resultMsg = message
        }
      }

      setGenAiResult(span, {
        outputMessages: [{ role: 'assistant', content: JSON.stringify(result) }],
        inputTokens: resultMsg?.usage.input_tokens,
        outputTokens: resultMsg?.usage.output_tokens,
        cacheReadInputTokens: resultMsg?.usage.cache_read_input_tokens,
        cacheCreationInputTokens: resultMsg?.usage.cache_creation_input_tokens,
        totalCostUsd: resultMsg?.total_cost_usd,
        responseModel: MODELS.HAIKU,
      })

      if (!result)
        return

      const parsed = ArtifactSchema.safeParse(result)
      if (!parsed.success)
        return

      const data = parsed.data

      // Save artifacts to DB
      for (const artifact of data.artifacts) {
        await saveArtifact({
          sessionId: ctx.sessionId,
          patientId: ctx.patientId,
          type: artifact.type,
          content: artifact.content,
          verbatimQuote: artifact.verbatimQuote,
          clinicalRelevance: artifact.clinicalRelevance,
        })
      }

      // Apply profile updates
      const updates = data.profileUpdates
      if (
        updates.newThemes?.length
        || updates.newTriggers?.length
        || updates.progressNote
      ) {
        const patient = await updatePatientProfile(ctx.telegramId, {})
        if (patient) {
          const profile: PatientProfile
            = (patient.profile as PatientProfile) ?? {}

          if (updates.newThemes?.length) {
            const themes = profile.recurringThemes ?? []
            for (const theme of updates.newThemes) {
              const existing = themes.find(t => t.theme === theme)
              if (existing) {
                existing.frequency++
              }
              else {
                themes.push({ theme, frequency: 1, trend: 'new' })
              }
            }
            profile.recurringThemes = themes
          }

          if (updates.newTriggers?.length) {
            const existing = new Set(profile.triggers ?? [])
            for (const t of updates.newTriggers) existing.add(t)
            profile.triggers = [...existing]
          }

          if (updates.progressNote) {
            profile.progressNotes = [
              ...(profile.progressNotes ?? []),
              {
                date: new Date().toISOString().split('T')[0],
                note: updates.progressNote,
              },
            ]
          }

          await updatePatientProfile(ctx.telegramId, profile)
          await writeProfile(ctx.profilePath, ctx.telegramId, profile)
        }
      }

      // Generate SOAP note if needed
      if (data.shouldGenerateSoapNote) {
        await generateSoapNote(ctx)
      }
    }
    catch (err) {
      logger.error('Artifact extraction failed:', err)
    }
  })
}

async function generateSoapNote(ctx: SessionContext): Promise<void> {
  await withGenAiSpan('chat', MODELS.HAIKU, {
    'gen_ai.output.type': 'json',
    'bot.session_id': ctx.sessionId,
  }, async (span) => {
    try {
      const profileContent = await readProfile(ctx.profilePath)

      const prompt = `Generate a SOAP note for this therapy session.

Patient profile:
${profileContent || 'No profile available'}

Session type: ${ctx.sessionType}
Session ID: ${ctx.sessionId}

Provide a structured SOAP note based on the therapy session.`

      const systemPrompt = 'You are a clinical documentation assistant. Generate concise, professional SOAP notes for therapy sessions.'

      setGenAiContext(span, {
        systemPrompt,
        inputMessages: [{ role: 'user', content: prompt }],
        toolDefinitions: [],
      })

      let result: unknown = null
      let resultMsg: SDKResultSuccess | undefined

      const q = query({
        prompt,
        options: {
          systemPrompt,
          model: MODELS.HAIKU,
          tools: [],
          maxTurns: 1,
          maxBudgetUsd: 0.02,
          persistSession: false,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          outputFormat: {
            type: 'json_schema',
            schema: z.toJSONSchema(soapSchema),
          },
        },
      })

      for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
          result = message.structured_output
          resultMsg = message
        }
      }

      setGenAiResult(span, {
        outputMessages: [{ role: 'assistant', content: JSON.stringify(result) }],
        inputTokens: resultMsg?.usage.input_tokens,
        outputTokens: resultMsg?.usage.output_tokens,
        cacheReadInputTokens: resultMsg?.usage.cache_read_input_tokens,
        cacheCreationInputTokens: resultMsg?.usage.cache_creation_input_tokens,
        totalCostUsd: resultMsg?.total_cost_usd,
        responseModel: MODELS.HAIKU,
      })

      if (!result)
        return

      const parsed = soapSchema.safeParse(result)
      if (!parsed.success)
        return

      const notePath = join(
        dirname(ctx.transcriptPath),
        'notes.md',
      )

      await writeSoapNote(
        notePath,
        ctx.sessionId,
        new Date().toISOString().split('T')[0],
        parsed.data,
      )
    }
    catch (err) {
      logger.error('SOAP note generation failed:', err)
    }
  })
}
