import type { BotContext } from '~/bot/context'
import { mkdir } from 'node:fs/promises'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_CONVERSATION_ID, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating'
import * as z from 'zod'
import { tracedQuery } from '~/agent/query'
import { FORMATTING_INSTRUCTIONS } from '~/agent/system-prompt'
import { isStaleSessionError } from '~/agent/therapist'
import { sendMarkdownV2 } from '~/bot/utils/telegram-send'
import { ANTHROPIC_MODEL_CLAUDE_SONNET, ATTR_TELEGRAM_CHAT_ID } from '~/constants'
import { addChatMember, findOrCreateChat, getChatMembers } from '~/db/queries/chats'
import { completeOnboarding as completeOnboardingRecord, createOnboarding, findOnboarding, updateOnboardingSdkSessionId } from '~/db/queries/onboardings'
import { findPatientByTelegramId } from '~/db/queries/patients'
import { couplesDir, relationshipProfilePath } from '~/paths'
import { writeRelationshipProfile } from '~/storage/profile'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

interface CouplesOnboardingSession {
  onboardingId: number
  internalChatId: number
  sdkSessionId?: string
  partnerIds: Set<number>
  partnerNames: Map<number, string>
  lastResponseAt: number
  reminderSent: boolean
  reminderTimer?: ReturnType<typeof setTimeout>
  deadlineTimer?: ReturnType<typeof setTimeout>
}

interface CouplesOnboardingBuffer {
  messages: string[] // already formatted as "[SenderName]: text"
  processing: boolean
  ctx: BotContext
}

const couplesOnboardingState = new Map<number, CouplesOnboardingSession>()
const couplesOnboardingBuffer = new Map<number, CouplesOnboardingBuffer>()

const REMINDER_DELAY_MS = 5 * 60 * 1000 // 5 minutes
const DEADLINE_DELAY_MS = 10 * 60 * 1000 // 10 minutes

const COUPLES_ONBOARDING_SYSTEM_PROMPT = `You are Mira, an extremely experienced couples therapist welcoming a new couple. You are a real person. A warm, perceptive woman with decades of clinical practice. You never question your own identity or break character. You simply are Mira.

You are conducting an intake conversation with a couple in a Telegram group chat. Both partners have already completed their individual onboarding, so you know their names.

Your goal is to naturally collect the following relationship-level information through conversation:
- How long they have been together
- The reason they are seeking couples therapy
- Their shared goals for therapy

Important guidelines:
- Adapt to whatever language the partners write in. If they write in Czech, respond in Czech. If English, respond in English, etc.
- Be conversational and warm. Don't make it feel like a form.
- Messages from partners are prefixed with their name in brackets, e.g. [Alice]: message text. Use this to distinguish who said what.
- Actively invite both partners to share their perspective. Address them by name.
- You can collect multiple pieces of information from a single message if a partner volunteers them.
- If only one partner is responding, gently encourage the other to share as well.
- If you receive a [System] message saying a partner has not responded, proceed with the information you have.
- When you have gathered enough information (or been told to proceed with partial data), call the complete_couples_onboarding tool.
- Start by greeting both partners warmly and asking about their relationship.
- Never use dashes as delimiters or separators in your responses. Dashes are only acceptable in list items.

${FORMATTING_INSTRUCTIONS}`

function clearTimers(state: CouplesOnboardingSession): void {
  if (state.reminderTimer) {
    clearTimeout(state.reminderTimer)
    state.reminderTimer = undefined
  }

  if (state.deadlineTimer) {
    clearTimeout(state.deadlineTimer)
    state.deadlineTimer = undefined
  }
}

function createCouplesOnboardingTools(chatId: number, onboardingId: number) {
  let resolveCompletion: (() => void) | null = null

  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  const server = createSdkMcpServer({
    name: 'couples-onboarding-tools',
    version: '1.0.0',
    tools: [
      tool(
        'complete_couples_onboarding',
        'Call this when you have gathered enough relationship information from the couple to complete their couples onboarding.',
        {
          partner1: z.string().describe('Name of the first partner'),
          partner2: z.string().describe('Name of the second partner'),
          duration: z.string().optional().describe('How long the couple has been together'),
          reason: z.string().optional().describe('Reason for seeking couples therapy'),
          sharedGoals: z.array(z.string()).optional().describe('Shared goals for therapy'),
        },
        async (args) => {
          // Write RELATIONSHIP.md — best-effort, can be regenerated
          try {
            const relationshipPath = relationshipProfilePath(chatId)

            await writeRelationshipProfile(relationshipPath, {
              chatId,
              partner1: args.partner1,
              partner2: args.partner2,
              duration: args.duration,
              reason: args.reason,
              sharedGoals: args.sharedGoals,
            })
          }
          catch (err) {
            logger.warn(`[couples-onboarding] Failed to write RELATIONSHIP.md for chat ${chatId}, will be regenerated`, err)
          }

          // Mark onboarding record as complete
          await completeOnboardingRecord(onboardingId)

          logger.info(`[couples-onboarding] Completed onboarding for chat ${chatId} (${args.partner1} & ${args.partner2})`)

          const state = couplesOnboardingState.get(chatId)

          if (state) {
            clearTimers(state)
          }

          couplesOnboardingState.delete(chatId)
          couplesOnboardingBuffer.delete(chatId)
          resolveCompletion?.()

          return {
            content: [{
              type: 'text' as const,
              text: 'Couples onboarding complete. Now send a warm message to the couple acknowledging their relationship profile is set up and that they can start their first couples session by writing anything.',
            }],
          }
        },
        { annotations: { readOnlyHint: false } },
      ),
    ],
  })

  return { server, completionPromise }
}

async function resolvePartnerContext(state: CouplesOnboardingSession): Promise<string> {
  const names = [...state.partnerNames.values()]

  if (names.length === 0)
    return ''

  return `\nPartners in this session: ${names.join(' and ')}.`
}

async function runCouplesOnboardingAgent(
  ctx: BotContext,
  telegramChatId: number,
  onboardingId: number,
  userMessage: string,
  sdkSessionId?: string,
): Promise<string> {
  const state = couplesOnboardingState.get(telegramChatId)

  if (!state)
    return ''

  const partnerContext = await resolvePartnerContext(state)
  const { server } = createCouplesOnboardingTools(telegramChatId, onboardingId)

  const systemPrompt = COUPLES_ONBOARDING_SYSTEM_PROMPT + partnerContext
  const allowedTools = ['mcp__couples-onboarding-tools__complete_couples_onboarding']
  const cwd = couplesDir(telegramChatId)

  // Ensure cwd exists before SDK subprocess starts
  await mkdir(cwd, { recursive: true })

  const queryArgs = (resume?: string) => [
    {
      operationName: GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
      label: 'couples-onboarding',
      attributes: {
        [ATTR_GEN_AI_AGENT_NAME]: 'couples-onboarding',
        [ATTR_TELEGRAM_CHAT_ID]: telegramChatId,
      },
    },
    {
      prompt: userMessage,
      options: {
        systemPrompt,
        model: ANTHROPIC_MODEL_CLAUDE_SONNET,
        cwd,
        mcpServers: { 'couples-onboarding-tools': server },
        allowedTools,
        tools: [] as string[],
        maxTurns: 5,
        maxBudgetUsd: 2,
        persistSession: true,
        permissionMode: 'dontAsk' as const,
        stderr: (data: string) => logger.warn('[couples-onboarding:stderr]', data),
        ...(resume ? { resume } : {}),
      },
    },
    {
      onSuccess: (result: { sessionId: string }, span: { setAttribute: (key: string, value: string) => void }) => {
        span.setAttribute(ATTR_GEN_AI_CONVERSATION_ID, result.sessionId)
      },
    },
  ] as const

  let queryResult: Awaited<ReturnType<typeof tracedQuery>>

  logger.debug(`[couples-onboarding] Running agent: chatId=${telegramChatId} resume=${!!sdkSessionId} cwd=${cwd}`)

  try {
    queryResult = await tracedQuery(...queryArgs(sdkSessionId))
  }
  catch (err) {
    if (sdkSessionId && isStaleSessionError(err)) {
      logger.warn(`[couples-onboarding] Stale session ${sdkSessionId}, retrying without resume`)

      if (state)
        state.sdkSessionId = undefined

      queryResult = await tracedQuery(...queryArgs())
    }
    else {
      throw err
    }
  }

  logger.debug(`[couples-onboarding] Agent completed: chatId=${telegramChatId} responseLength=${queryResult.response.length}`)

  if (state) {
    state.sdkSessionId = queryResult.sessionId
    await updateOnboardingSdkSessionId(state.onboardingId, queryResult.sessionId)
  }

  return queryResult.response
}

function setupTimers(ctx: BotContext, telegramChatId: number): void {
  const state = couplesOnboardingState.get(telegramChatId)

  if (!state)
    return

  clearTimers(state)

  state.lastResponseAt = Date.now()
  state.reminderSent = false

  // Reminder timer (5 minutes)
  state.reminderTimer = setTimeout(async () => {
    const currentState = couplesOnboardingState.get(telegramChatId)

    if (!currentState || currentState.reminderSent)
      return

    currentState.reminderSent = true

    // Find which partner hasn't responded
    const allNames = [...currentState.partnerNames.values()]
    const respondedIds = currentState.partnerIds
    const missingPartners = [...currentState.partnerNames.entries()]
      .filter(([id]) => !respondedIds.has(id))
      .map(([, name]) => name)

    const missingName = missingPartners.length > 0 ? missingPartners[0] : allNames[1] ?? 'your partner'

    try {
      await sendMarkdownV2({
        chatId: telegramChatId,
        text: `Just a gentle reminder — I'd love to hear from both of you\\. If *${missingName}* doesn't respond soon, I'll continue with what we have so far\\.`,
        api: ctx.api,
      })
    }
    catch (err) {
      logger.error('[couples-onboarding] Failed to send reminder:', err)
    }
  }, REMINDER_DELAY_MS)

  // Deadline timer (10 minutes)
  state.deadlineTimer = setTimeout(async () => {
    const currentState = couplesOnboardingState.get(telegramChatId)

    if (!currentState)
      return

    const allNames = [...currentState.partnerNames.values()]
    const respondedIds = currentState.partnerIds
    const missingPartners = [...currentState.partnerNames.entries()]
      .filter(([id]) => !respondedIds.has(id))
      .map(([, name]) => name)

    const missingName = missingPartners.length > 0 ? missingPartners[0] : allNames[1] ?? 'a partner'
    const systemMessage = `[System]: ${missingName} has not responded. Proceed with available information.`

    try {
      const buffer = couplesOnboardingBuffer.get(telegramChatId)

      // If already processing a user message, just push the system message into the buffer
      if (buffer?.processing) {
        buffer.messages.push(systemMessage)
        buffer.ctx = ctx
        logger.debug(`[couples-onboarding] Deadline message buffered for chat ${telegramChatId}`)
        return
      }

      // Start the drain loop for the system message
      couplesOnboardingBuffer.set(telegramChatId, { messages: [systemMessage], processing: true, ctx })
      await drainCouplesOnboardingBuffer(telegramChatId, currentState)
    }
    catch (err) {
      logger.error('[couples-onboarding] Failed to process deadline:', err)
    }
  }, DEADLINE_DELAY_MS)
}

export function isCouplesOnboarding(chatId: number): boolean {
  return couplesOnboardingState.has(chatId)
}

export async function startCouplesOnboarding(ctx: BotContext): Promise<void> {
  const telegramChatId = ctx.chat!.id
  const telegramId = ctx.from!.id

  return withSpan('bot.couples-onboarding.start', { [ATTR_TELEGRAM_CHAT_ID]: telegramChatId }, async () => {
    // Resolve internal chat entity
    const chat = await findOrCreateChat(telegramChatId, 'couples')

    // Look up sender's patient record for their name and register as member
    const patient = await findPatientByTelegramId(telegramId)
    const senderName = patient?.firstName ?? ctx.from!.first_name ?? 'Partner'

    if (patient) {
      await addChatMember(chat.id, patient.id)
    }

    logger.info(`[couples-onboarding] Starting onboarding for chat ${telegramChatId}, initiated by ${senderName}`)

    // Check for existing in-progress onboarding in DB (survives restart)
    let onboarding = await findOnboarding('couples', { chatId: chat.id })
    let resumeSessionId: string | undefined

    if (onboarding?.sdkSessionId) {
      resumeSessionId = onboarding.sdkSessionId
      logger.info(`[couples-onboarding] Found existing onboarding ${onboarding.id} with SDK session, resuming`)
    }
    else if (!onboarding) {
      onboarding = await createOnboarding('couples', { chatId: chat.id })
      logger.info(`[couples-onboarding] Created new onboarding record ${onboarding.id}`)
    }

    // Build partner names from chat_members
    const partnerNames = new Map<number, string>([[telegramId, senderName]])
    const members = await getChatMembers(chat.id)
    for (const member of members) {
      if (!partnerNames.has(member.telegramId)) {
        partnerNames.set(member.telegramId, member.firstName ?? 'Partner')
      }
    }

    const state: CouplesOnboardingSession = {
      onboardingId: onboarding.id,
      internalChatId: chat.id,
      sdkSessionId: resumeSessionId,
      partnerIds: new Set([telegramId]),
      partnerNames,
      lastResponseAt: Date.now(),
      reminderSent: false,
    }

    couplesOnboardingState.set(telegramChatId, state)
    // Acquire buffer lock before initial agent call to prevent concurrent calls
    couplesOnboardingBuffer.set(telegramChatId, { messages: [], processing: true, ctx })

    try {
      const initialMessage = resumeSessionId
        ? `[${senderName}]: ${ctx.message?.text ?? 'Hello'}\n[System]: The couple has reconnected. Continue the onboarding conversation from where you left off.`
        : `[${senderName}]: ${ctx.message?.text ?? 'Hello'}`

      const response = await runCouplesOnboardingAgent(
        ctx,
        telegramChatId,
        onboarding.id,
        initialMessage,
        resumeSessionId,
      )

      if (response) {
        await sendMarkdownV2({ chatId: telegramChatId, text: response, api: ctx.api })
        setupTimers(ctx, telegramChatId)
      }
      else {
        logger.error(`[couples-onboarding] Empty response from onboarding agent for chat ${telegramChatId}`)
        await ctx.reply('I\'m having trouble starting up. Please try again in a moment.')
      }
    }
    catch (err) {
      logger.error(`[couples-onboarding] Error during initial onboarding for chat ${telegramChatId}:`, err)
      await ctx.reply('I\'m having trouble starting up. Please try again in a moment.')
    }

    // Drain any messages that arrived during the initial agent call
    if (couplesOnboardingState.has(telegramChatId)) {
      await drainCouplesOnboardingBuffer(telegramChatId, state)
    }
    else {
      couplesOnboardingBuffer.delete(telegramChatId)
    }
  })
}

export async function handleCouplesOnboardingMessage(ctx: BotContext): Promise<void> {
  const telegramChatId = ctx.chat!.id
  const telegramId = ctx.from!.id
  const state = couplesOnboardingState.get(telegramChatId)

  if (!state)
    return

  const text = ctx.message?.text?.trim()

  if (!text)
    return

  // Register partner eagerly (before buffer check) so new partners are tracked immediately
  if (!state.partnerNames.has(telegramId)) {
    const patient = await findPatientByTelegramId(telegramId)
    const name = patient?.firstName ?? ctx.from!.first_name ?? 'Partner'
    state.partnerNames.set(telegramId, name)

    // Add as chat member in DB
    if (patient) {
      await addChatMember(state.internalChatId, patient.id)
    }
  }

  state.partnerIds.add(telegramId)

  // Reset timers on any incoming message
  clearTimers(state)
  state.reminderSent = false

  const senderName = state.partnerNames.get(telegramId) ?? 'Partner'
  const formattedMessage = `[${senderName}]: ${text}`

  const buffer = couplesOnboardingBuffer.get(telegramChatId)

  // If already processing, just add to the buffer and return
  if (buffer?.processing) {
    buffer.messages.push(formattedMessage)
    buffer.ctx = ctx
    logger.debug(`[couples-onboarding] Buffered message from ${senderName} in chat ${telegramChatId} (${buffer.messages.length} pending)`)
    return
  }

  // Initialize buffer and start processing
  couplesOnboardingBuffer.set(telegramChatId, { messages: [formattedMessage], processing: true, ctx })

  return withSpan('bot.couples-onboarding.message', { [ATTR_TELEGRAM_CHAT_ID]: telegramChatId }, async () => {
    await drainCouplesOnboardingBuffer(telegramChatId, state)
  })
}

async function drainCouplesOnboardingBuffer(telegramChatId: number, state: CouplesOnboardingSession): Promise<void> {
  while (couplesOnboardingBuffer.has(telegramChatId)) {
    const buffer = couplesOnboardingBuffer.get(telegramChatId)!
    if (buffer.messages.length === 0)
      break

    const combinedMessage = buffer.messages.join('\n')
    const ctx = buffer.ctx
    buffer.messages = []

    logger.debug(`[couples-onboarding] Processing messages for chat ${telegramChatId}`)

    // Show typing indicator
    ctx.api.sendChatAction(telegramChatId, 'typing').catch(() => {})

    const response = await runCouplesOnboardingAgent(
      ctx,
      telegramChatId,
      state.onboardingId,
      combinedMessage,
      state.sdkSessionId,
    )

    if (response) {
      await sendMarkdownV2({ chatId: telegramChatId, text: response, api: ctx.api })
      // Only set up timers if onboarding is still active (tool may have completed it)
      if (couplesOnboardingState.has(telegramChatId)) {
        setupTimers(ctx, telegramChatId)
      }
    }
    else {
      logger.error(`[couples-onboarding] Empty response from onboarding agent for chat ${telegramChatId}`)
      await ctx.reply('I\'m having trouble processing your message. Please try again.')
    }

    // Check if more messages arrived during processing
    const currentBuffer = couplesOnboardingBuffer.get(telegramChatId)
    if (!currentBuffer || currentBuffer.messages.length === 0)
      break
  }

  // Done processing — clean up
  const buffer = couplesOnboardingBuffer.get(telegramChatId)
  if (buffer) {
    buffer.processing = false
    if (buffer.messages.length === 0)
      couplesOnboardingBuffer.delete(telegramChatId)
  }
}
