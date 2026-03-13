import type { BotContext } from '~/bot/context'
import type { PatientProfile } from '~/db/schema/patients'
import { mkdir } from 'node:fs/promises'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_CONVERSATION_ID, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating'
import * as z from 'zod'
import { tracedQuery } from '~/agent/query'
import { FORMATTING_INSTRUCTIONS } from '~/agent/system-prompt'
import { isStaleSessionError } from '~/agent/therapist'
import { replyMarkdownV2 } from '~/bot/utils/telegram-send'
import { ANTHROPIC_MODEL_CLAUDE_SONNET, ATTR_TELEGRAM_USER_ID } from '~/constants'
import { completeOnboarding, createPatient, findPatientByTelegramId } from '~/db/queries/patients'
import { PatientProfileSchema } from '~/db/schema/patients'
import { patientDir, patientProfilePath } from '~/paths'
import { writeProfile } from '~/storage/profile'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

interface OnboardingSession {
  sdkSessionId?: string
}

interface OnboardingBuffer {
  messages: string[]
  processing: boolean
  ctx: BotContext
}

const onboardingState = new Map<number, OnboardingSession>()
const onboardingBuffer = new Map<number, OnboardingBuffer>()

const ONBOARDING_SYSTEM_PROMPT = `You are Mira, an extremely experienced therapist welcoming a new client. You are a real person. A warm, perceptive woman with decades of clinical practice. You never question your own identity or break character. You simply are Mira.

You are conducting an intake conversation with a new client on Telegram. Your goal is to naturally collect the following information through conversation:
- Their name (how they'd like to be called)
- Date of birth (accept any format the user provides)
- Gender identity (optional, they can skip)
- Occupation (optional, they can skip)
- Relationship status
- Previous therapy experience
- Goals for therapy
- Preferred language for communication

Important guidelines:
- Adapt to whatever language the user writes in. If they write in Czech, respond in Czech. If English, respond in English, etc.
- Be conversational and warm. Don't make it feel like a form.
- You can collect multiple pieces of information from a single message if the user volunteers them.
- If the user says "skip" or declines to answer an optional question, move on gracefully.
- When you have gathered enough information, call the complete_onboarding tool with the collected data.
- For date of birth:
  - Accept ANY format (YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY, MM/DD/YYYY, "March 4 1990", "4. března 1990", etc.).
  - Use context clues to interpret: user's language, locale conventions, and the Telegram language code.
  - IMPORTANT: If the date is AMBIGUOUS (both day and month ≤ 12, e.g. "03/04/1990"), you MUST confirm your interpretation with the user. Example: "Just to make sure: did you mean March 4th, 1990, or April 3rd, 1990?"
  - If UNAMBIGUOUS (e.g. "25/12/1990", since 25 can't be a month), parse confidently without confirmation.
  - If user gives just an age, estimate DOB (current year minus age, January 1st).
  - When calling complete_onboarding, always convert to YYYY-MM-DD format.
- Never use dashes as delimiters or separators in your responses. Dashes are only acceptable in list items.
- Start by greeting them warmly and asking for their name.

${FORMATTING_INSTRUCTIONS}`

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
          dateOfBirth: z.string().optional().describe('Date of birth normalized to YYYY-MM-DD format (convert from whatever format the user provided)'),
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

          // Persist to DB — source of truth
          const patient = await completeOnboarding(telegramId, profile)

          if (patient) {
            ctx.session.patientId = patient.id
          }

          // Write PROFILE.md — best-effort, note-taker regenerates if missing
          try {
            const profilePath = patientProfilePath(telegramId)
            await writeProfile(profilePath, telegramId, profile)
          }
          catch (err) {
            logger.warn(`[onboarding] Failed to write PROFILE.md for user ${telegramId}, will be regenerated`, err)
          }

          logger.info(`[onboarding] Completed onboarding for user ${telegramId} (${profile.fullName})`)

          onboardingState.delete(telegramId)
          onboardingBuffer.delete(telegramId)
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
  const { server } = createOnboardingTools(ctx, telegramId)
  const languageCode = ctx.from?.language_code

  const languageHint = languageCode
    ? `\nThe user's Telegram language is set to "${languageCode}". Consider starting in this language unless they write in a different one.`
    : ''

  const systemPrompt = ONBOARDING_SYSTEM_PROMPT + languageHint
  const allowedTools = ['mcp__onboarding-tools__complete_onboarding']
  const cwd = patientDir(telegramId)

  // Ensure cwd exists before SDK subprocess starts
  await mkdir(cwd, { recursive: true })

  const queryArgs = (resume?: string) => [
    {
      operationName: GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
      label: 'onboarding',
      attributes: {
        [ATTR_GEN_AI_AGENT_NAME]: 'onboarding',
        [ATTR_TELEGRAM_USER_ID]: telegramId,
      },
    },
    {
      prompt: userMessage,
      options: {
        systemPrompt,
        model: ANTHROPIC_MODEL_CLAUDE_SONNET,
        cwd,
        mcpServers: { 'onboarding-tools': server },
        allowedTools,
        tools: [] as string[],
        maxTurns: 5,
        maxBudgetUsd: 2,
        persistSession: true,
        permissionMode: 'dontAsk' as const,
        stderr: (data: string) => logger.warn('[onboarding:stderr]', data),
        ...(resume ? { resume } : {}),
      },
    },
    {
      onSuccess: (result: { sessionId: string }, span: { setAttribute: (key: string, value: string) => void }) => {
        span.setAttribute(ATTR_GEN_AI_CONVERSATION_ID, result.sessionId)
      },
    },
  ] as const

  let result: Awaited<ReturnType<typeof tracedQuery>>

  logger.debug(`[onboarding] Running agent: telegramId=${telegramId} resume=${!!sdkSessionId} cwd=${cwd}`)

  try {
    result = await tracedQuery(...queryArgs(sdkSessionId))
  }
  catch (err) {
    if (sdkSessionId && isStaleSessionError(err)) {
      logger.warn(`[onboarding] Stale session ${sdkSessionId}, retrying without resume`)
      const state = onboardingState.get(telegramId)
      if (state)
        state.sdkSessionId = undefined
      result = await tracedQuery(...queryArgs())
    }
    else {
      throw err
    }
  }

  logger.debug(`[onboarding] Agent completed: telegramId=${telegramId} responseLength=${result.response.length}`)

  // Update stored SDK session ID
  const state = onboardingState.get(telegramId)

  if (state) {
    state.sdkSessionId = result.sessionId
  }

  return result.response
}

export async function startOnboarding(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id

  return withSpan('bot.onboarding.start', { [ATTR_TELEGRAM_USER_ID]: telegramId }, async () => {
    // Ensure patient record exists
    let patient = await findPatientByTelegramId(telegramId)

    if (!patient) {
      patient = await createPatient({
        telegramId,
        firstName: ctx.from!.first_name,
        username: ctx.from!.username,
      })
      logger.info(`[onboarding] New patient created for user ${telegramId}`)
    }
    else {
      logger.info(`[onboarding] Restarting onboarding for existing user ${telegramId}`)
    }

    ctx.session.patientId = patient.id

    // Reset onboarding state (handles /start mid-onboarding)
    onboardingState.set(telegramId, {})
    onboardingBuffer.delete(telegramId)

    const response = await runOnboardingAgent(
      ctx,
      telegramId,
      'The user just started the bot. Greet them and begin onboarding.',
    )

    if (response) {
      await replyMarkdownV2(ctx, response)
    }
    else {
      logger.error(`[onboarding] Empty response from onboarding agent for user ${telegramId}`)
      await ctx.reply('I\'m having trouble starting up. Please try /start again in a moment.')
    }
  })
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

  const buffer = onboardingBuffer.get(telegramId)

  // If already processing, just add to the buffer and return
  if (buffer?.processing) {
    buffer.messages.push(text)
    buffer.ctx = ctx
    logger.debug(`[onboarding] Buffered message from user ${telegramId} (${buffer.messages.length} pending)`)
    return
  }

  // Initialize or reset buffer and start processing
  onboardingBuffer.set(telegramId, { messages: [text], processing: true, ctx })

  return withSpan('bot.onboarding.message', { [ATTR_TELEGRAM_USER_ID]: telegramId }, async () => {
    await drainOnboardingBuffer(telegramId, state)
  })
}

async function drainOnboardingBuffer(telegramId: number, state: OnboardingSession): Promise<void> {
  while (onboardingBuffer.has(telegramId)) {
    const buffer = onboardingBuffer.get(telegramId)!
    if (buffer.messages.length === 0)
      break

    const combinedMessage = buffer.messages.join('\n')
    const ctx = buffer.ctx
    buffer.messages = []

    logger.debug(`[onboarding] Processing message from user ${telegramId}`)

    const response = await runOnboardingAgent(ctx, telegramId, combinedMessage, state.sdkSessionId)

    if (response) {
      await replyMarkdownV2(ctx, response)
    }
    else {
      logger.error(`[onboarding] Empty response from onboarding agent for user ${telegramId}`)
      await ctx.reply('I\'m having trouble processing your message. Please try again.')
    }

    // Check if more messages arrived during processing
    const currentBuffer = onboardingBuffer.get(telegramId)
    if (!currentBuffer || currentBuffer.messages.length === 0)
      break
  }

  // Done processing — clean up
  const buffer = onboardingBuffer.get(telegramId)
  if (buffer) {
    buffer.processing = false
    if (buffer.messages.length === 0)
      onboardingBuffer.delete(telegramId)
  }
}
