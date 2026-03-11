import type { Options, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import type { BotContext } from '~/bot/context'
import type { PatientProfile } from '~/db/schema'
import { join } from 'node:path'
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'
import { config } from '~/config'
import { MODELS } from '~/constants'
import { completeOnboarding, createPatient, findPatientByTelegramId } from '~/db/queries/patients'
import { PatientProfileSchema } from '~/db/schema/patients'
import { writeProfile } from '~/storage/profile'
import { setGenAiContext, setGenAiResult, withGenAiSpan } from '~/telemetry/tracing'

interface OnboardingSession {
  sdkSessionId?: string
}

const onboardingState = new Map<number, OnboardingSession>()

const ONBOARDING_SYSTEM_PROMPT = `You are a warm, supportive AI therapy companion conducting an onboarding conversation with a new user on Telegram.

Your goal is to naturally collect the following information through conversation:
- Their name (how they'd like to be called)
- Date of birth (YYYY-MM-DD format)
- Gender identity (optional — they can skip)
- Occupation (optional — they can skip)
- Relationship status
- Previous therapy experience
- Goals for therapy
- Preferred language for communication

Important guidelines:
- Adapt to whatever language the user writes in. If they write in Czech, respond in Czech. If English, respond in English, etc.
- Be conversational and warm — don't make it feel like a form.
- You can collect multiple pieces of information from a single message if the user volunteers them.
- If the user says "skip" or declines to answer an optional question, move on gracefully.
- When you have gathered enough information, call the complete_onboarding tool with the collected data.
- For date of birth, if the user gives just an age or a partial date, try to work with what they give. If they only give an age, estimate a date of birth from it (use the current year minus their age, January 1st).
- Start by greeting them warmly and asking for their name.`

function createOnboardingTools(ctx: BotContext, telegramId: number) {
  let resolveCompletion: ((profile: PatientProfile) => void) | null = null

  const completionPromise = new Promise<PatientProfile>((resolve) => {
    resolveCompletion = resolve
  })

  const server = createSdkMcpServer({
    name: 'onboarding-tools',
    version: '1.0.0',
    tools: [
      tool(
        'complete_onboarding',
        'Call this when you have gathered enough profile information from the user to complete their onboarding.',
        {
          fullName: z.string().describe('The name the user wants to be called'),
          dateOfBirth: z.string().optional().describe('Date of birth in YYYY-MM-DD format'),
          gender: z.string().optional().describe('Gender identity'),
          occupation: z.string().optional().describe('Their occupation'),
          relationshipStatus: z.string().optional().describe('Current relationship status'),
          previousTherapyExperience: z.string().optional().describe('Previous therapy experience'),
          therapyGoals: z.array(z.string()).optional().describe('Goals for therapy'),
          preferredLanguage: z.string().optional().describe('Preferred language code, e.g. "en", "cs", "de"'),
        },
        async (args) => {
          const profile = PatientProfileSchema.parse({
            fullName: args.fullName,
            dateOfBirth: args.dateOfBirth,
            gender: args.gender,
            occupation: args.occupation,
            relationshipStatus: args.relationshipStatus,
            previousTherapyExperience: args.previousTherapyExperience,
            therapyGoals: args.therapyGoals,
            preferredLanguage: args.preferredLanguage,
          })

          // Persist to DB
          const patient = await completeOnboarding(telegramId, profile)

          if (patient) {
            ctx.session.patientId = patient.id
          }

          // Write PROFILE.md
          const profilePath = join(config.DATA_DIR, 'patients', telegramId.toString(), 'PROFILE.md')

          await writeProfile(profilePath, telegramId, profile)

          onboardingState.delete(telegramId)
          resolveCompletion?.(profile)

          return {
            content: [{
              type: 'text' as const,
              text: 'Onboarding complete. Now send a warm message to the user acknowledging their profile is set up and that they can start their first session by writing anything.',
            }],
          }
        },
        { annotations: { readOnlyHint: false } },
      ),
    ],
  })

  return { server, completionPromise }
}

async function runOnboardingAgent(ctx: BotContext, telegramId: number, userMessage: string, sdkSessionId?: string): Promise<string> {
  return withGenAiSpan('invoke_agent', MODELS.HAIKU, {
    'gen_ai.agent.name': 'onboarding',
    'telegram.user_id': telegramId,
  }, async (span) => {
    const { server } = createOnboardingTools(ctx, telegramId)
    const languageCode = ctx.from?.language_code

    const languageHint = languageCode
      ? `\nThe user's Telegram language is set to "${languageCode}". Consider starting in this language unless they write in a different one.`
      : ''

    const systemPrompt = ONBOARDING_SYSTEM_PROMPT + languageHint
    const allowedTools = ['mcp__onboarding-tools__complete_onboarding']

    setGenAiContext(span, {
      systemPrompt,
      inputMessages: [{ role: 'user', content: userMessage }],
      toolDefinitions: allowedTools.map(name => ({ name })),
    })

    let response = ''
    let newSdkSessionId = ''
    let resultMsg: SDKResultSuccess | undefined

    const options: Options = {
      systemPrompt,
      model: MODELS.HAIKU,
      mcpServers: { 'onboarding-tools': server },
      allowedTools,
      tools: [],
      maxTurns: 3,
      maxBudgetUsd: 0.02,
      persistSession: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      ...(sdkSessionId ? { resume: sdkSessionId } : {}),
    }

    const q = query({ prompt: userMessage, options })

    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success') {
        response = message.result
        newSdkSessionId = message.session_id
        resultMsg = message
      }
    }

    // Update stored SDK session ID
    const state = onboardingState.get(telegramId)

    if (state) {
      state.sdkSessionId = newSdkSessionId
    }

    span.setAttribute('gen_ai.conversation.id', newSdkSessionId)

    setGenAiResult(span, {
      outputMessages: [{ role: 'assistant', content: response }],
      inputTokens: resultMsg?.usage.input_tokens,
      outputTokens: resultMsg?.usage.output_tokens,
      cacheReadInputTokens: resultMsg?.usage.cache_read_input_tokens,
      cacheCreationInputTokens: resultMsg?.usage.cache_creation_input_tokens,
      totalCostUsd: resultMsg?.total_cost_usd,
      responseModel: MODELS.HAIKU,
    })

    return response
  })
}

export async function startOnboarding(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id

  // Ensure patient record exists
  let patient = await findPatientByTelegramId(telegramId)

  if (!patient) {
    patient = await createPatient({
      telegramId,
      firstName: ctx.from!.first_name,
      username: ctx.from!.username,
    })
  }

  ctx.session.patientId = patient.id

  // Reset onboarding state (handles /start mid-onboarding)
  onboardingState.set(telegramId, {})

  const response = await runOnboardingAgent(
    ctx,
    telegramId,
    'The user just started the bot. Greet them and begin onboarding.',
  )

  if (response) {
    await ctx.reply(response)
  }
}

export function isOnboarding(telegramId: number): boolean {
  return onboardingState.has(telegramId)
}

export async function handleOnboardingMessage(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id
  const state = onboardingState.get(telegramId)

  if (!state)
    return

  const text = ctx.message?.text?.trim()

  if (!text)
    return

  const response = await runOnboardingAgent(ctx, telegramId, text, state.sdkSessionId)

  if (response) {
    await ctx.reply(response)
  }
}
