import type { SessionContext } from '~/agent/context-assembler'
import type { PatientProfile } from '~/db/schema'
import { dirname, join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'
import { saveArtifact } from '~/db/queries/artifacts'
import { updatePatientProfile } from '~/db/queries/patients'
import { readProfile, writeProfile } from '~/storage/profile'
import { writeSoapNote } from '~/storage/soap-notes'

const ArtifactSchema = z.object({
  artifacts: z.array(
    z.object({
      type: z.enum([
        'disclosure',
        'insight',
        'emotion',
        'coping_strategy',
        'trigger',
        'goal',
        'pattern',
        'homework',
      ]),
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

const SoapSchema = z.object({
  subjective: z.array(z.string()),
  objective: z.array(z.string()),
  assessment: z.array(z.string()),
  plan: z.array(z.string()),
})

export async function extractArtifacts(
  ctx: SessionContext,
  patientMessage: string,
  therapistResponse: string,
): Promise<void> {
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

    let result: unknown = null

    const q = query({
      prompt,
      options: {
        systemPrompt:
          'You are a clinical note-taking assistant. Extract therapy artifacts from the exchange. Be precise and clinical. Only extract genuinely significant items — not every message warrants artifacts.',
        model: 'claude-haiku-4-5-20251001',
        tools: [],
        maxTurns: 1,
        maxBudgetUsd: 0.02,
        persistSession: false,
        outputFormat: {
          type: 'json_schema',
          schema: z.toJSONSchema(ArtifactSchema),
        },
      },
    })

    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success') {
        result = message.structured_output
      }
    }

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
    console.error('Artifact extraction failed:', err)
  }
}

async function generateSoapNote(ctx: SessionContext): Promise<void> {
  try {
    const profileContent = await readProfile(ctx.profilePath)

    const prompt = `Generate a SOAP note for this therapy session.

Patient profile:
${profileContent || 'No profile available'}

Session type: ${ctx.sessionType}
Session ID: ${ctx.sessionId}

Provide a structured SOAP note based on the therapy session.`

    let result: unknown = null

    const q = query({
      prompt,
      options: {
        systemPrompt:
          'You are a clinical documentation assistant. Generate concise, professional SOAP notes for therapy sessions.',
        model: 'claude-haiku-4-5-20251001',
        tools: [],
        maxTurns: 1,
        maxBudgetUsd: 0.02,
        persistSession: false,
        outputFormat: {
          type: 'json_schema',
          schema: z.toJSONSchema(SoapSchema),
        },
      },
    })

    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success') {
        result = message.structured_output
      }
    }

    if (!result)
      return

    const parsed = SoapSchema.safeParse(result)
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
    console.error('SOAP note generation failed:', err)
  }
}
