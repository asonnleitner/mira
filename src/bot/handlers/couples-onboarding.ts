import type { BotContext } from '~/bot/context'
import { join } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_CONVERSATION_ID, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating'
import * as z from 'zod'
import { tracedQuery } from '~/agent/query'
import { isStaleSessionError } from '~/agent/therapist'
import { sendMarkdownV2 } from '~/bot/utils/telegram-send'
import { config } from '~/config'
import { ANTHROPIC_MODEL_CLAUDE_SONNET, ATTR_TELEGRAM_CHAT_ID } from '~/constants'
import { findPatientByTelegramId } from '~/db/queries/patients'
import { writeRelationshipProfile } from '~/storage/profile'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

interface CouplesOnboardingSession {
  sdkSessionId?: string
  partnerIds: Set<number>
  partnerNames: Map<number, string>
  lastResponseAt: number
  reminderSent: boolean
  reminderTimer?: ReturnType<typeof setTimeout>
  deadlineTimer?: ReturnType<typeof setTimeout>
}

const couplesOnboardingState = new Map<number, CouplesOnboardingSession>()

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

## Formatting
Your responses are rendered in Telegram using MarkdownV2 parse mode. You MUST follow these formatting rules exactly:

Supported syntax:
- *bold* (single asterisk)
- _italic_ (single underscore)
- __underline__ (double underscore)
- ~strikethrough~ (single tilde)
- ||spoiler|| (double pipe)
- \`inline code\` (single backtick)
- Nesting is supported: *bold _italic bold_*

CRITICAL: escape these characters with \\ when they appear as literal text (not as formatting markup):
_ * [ ] ( ) ~ \` > # + - = | { } . !

Examples of correct escaping:
- "That costs 10\\.99" (escape the dot)
- "Really\\!" (escape the exclamation mark)
- "It's okay \\(I promise\\)" (escape parentheses)
- "50\\-50 chance" (escape the hyphen)
- "C\\+\\+ developer" (escape plus signs)

Do NOT use:
- Double asterisks for bold (**text**). Use single: *text*
- Markdown headers (# Header)
- Markdown links with unescaped special chars in display text`

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

function createCouplesOnboardingTools(chatId: number) {
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
            const relationshipPath = join(config.DATA_DIR, 'couples', String(chatId), 'RELATIONSHIP.md')
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

          logger.info(`[couples-onboarding] Completed onboarding for chat ${chatId} (${args.partner1} & ${args.partner2})`)

          const state = couplesOnboardingState.get(chatId)
          if (state) {
            clearTimers(state)
          }
          couplesOnboardingState.delete(chatId)
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
  chatId: number,
  userMessage: string,
  sdkSessionId?: string,
): Promise<string> {
  const state = couplesOnboardingState.get(chatId)
  if (!state)
    return ''

  const partnerContext = await resolvePartnerContext(state)
  const { server } = createCouplesOnboardingTools(chatId)

  const systemPrompt = COUPLES_ONBOARDING_SYSTEM_PROMPT + partnerContext
  const allowedTools = ['mcp__couples-onboarding-tools__complete_couples_onboarding']

  const queryArgs = (resume?: string) => [
    {
      operationName: GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
      label: 'couples-onboarding',
      attributes: {
        [ATTR_GEN_AI_AGENT_NAME]: 'couples-onboarding',
        [ATTR_TELEGRAM_CHAT_ID]: chatId,
      },
    },
    {
      prompt: userMessage,
      options: {
        systemPrompt,
        model: ANTHROPIC_MODEL_CLAUDE_SONNET,
        cwd: join(config.DATA_DIR, 'couples', String(chatId)),
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

  if (state) {
    state.sdkSessionId = queryResult.sessionId
  }

  return queryResult.response
}

function setupTimers(ctx: BotContext, chatId: number): void {
  const state = couplesOnboardingState.get(chatId)
  if (!state)
    return

  clearTimers(state)
  state.lastResponseAt = Date.now()
  state.reminderSent = false

  // Reminder timer (5 minutes)
  state.reminderTimer = setTimeout(async () => {
    const currentState = couplesOnboardingState.get(chatId)
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
        chatId,
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
    const currentState = couplesOnboardingState.get(chatId)
    if (!currentState)
      return

    const allNames = [...currentState.partnerNames.values()]
    const respondedIds = currentState.partnerIds
    const missingPartners = [...currentState.partnerNames.entries()]
      .filter(([id]) => !respondedIds.has(id))
      .map(([, name]) => name)

    const missingName = missingPartners.length > 0 ? missingPartners[0] : allNames[1] ?? 'a partner'

    try {
      const response = await runCouplesOnboardingAgent(
        ctx,
        chatId,
        `[System]: ${missingName} has not responded. Proceed with available information.`,
        currentState.sdkSessionId,
      )

      if (response) {
        await sendMarkdownV2({ chatId, text: response, api: ctx.api })
        // Set up timers again in case agent needs another round
        if (couplesOnboardingState.has(chatId)) {
          setupTimers(ctx, chatId)
        }
      }
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
  const chatId = ctx.chat!.id
  const telegramId = ctx.from!.id

  return withSpan('bot.couples-onboarding.start', { [ATTR_TELEGRAM_CHAT_ID]: chatId }, async () => {
    // Look up sender's patient record for their name
    const patient = await findPatientByTelegramId(telegramId)
    const senderName = patient?.firstName ?? ctx.from!.first_name ?? 'Partner'

    logger.info(`[couples-onboarding] Starting onboarding for chat ${chatId}, initiated by ${senderName}`)

    const state: CouplesOnboardingSession = {
      partnerIds: new Set([telegramId]),
      partnerNames: new Map([[telegramId, senderName]]),
      lastResponseAt: Date.now(),
      reminderSent: false,
    }

    couplesOnboardingState.set(chatId, state)

    const response = await runCouplesOnboardingAgent(
      ctx,
      chatId,
      `[${senderName}]: ${ctx.message?.text ?? 'Hello'}`,
    )

    if (response) {
      await sendMarkdownV2({ chatId, text: response, api: ctx.api })
      setupTimers(ctx, chatId)
    }
    else {
      logger.error(`[couples-onboarding] Empty response from onboarding agent for chat ${chatId}`)
      await ctx.reply('I\'m having trouble starting up. Please try again in a moment.')
    }
  })
}

export async function handleCouplesOnboardingMessage(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat!.id
  const telegramId = ctx.from!.id
  const state = couplesOnboardingState.get(chatId)

  if (!state)
    return

  const text = ctx.message?.text?.trim()
  if (!text)
    return

  return withSpan('bot.couples-onboarding.message', { [ATTR_TELEGRAM_CHAT_ID]: chatId }, async () => {
    // Add this partner if new
    if (!state.partnerNames.has(telegramId)) {
      const patient = await findPatientByTelegramId(telegramId)
      const name = patient?.firstName ?? ctx.from!.first_name ?? 'Partner'
      state.partnerNames.set(telegramId, name)
    }

    state.partnerIds.add(telegramId)

    // Reset timers on any incoming message
    clearTimers(state)
    state.reminderSent = false

    const senderName = state.partnerNames.get(telegramId) ?? 'Partner'
    logger.debug(`[couples-onboarding] Received message from ${senderName} in chat ${chatId}`)

    // Show typing indicator
    ctx.api.sendChatAction(chatId, 'typing').catch(() => {})

    const response = await runCouplesOnboardingAgent(
      ctx,
      chatId,
      `[${senderName}]: ${text}`,
      state.sdkSessionId,
    )

    if (response) {
      await sendMarkdownV2({ chatId, text: response, api: ctx.api })
      // Only set up timers if onboarding is still active (tool may have completed it)
      if (couplesOnboardingState.has(chatId)) {
        setupTimers(ctx, chatId)
      }
    }
    else {
      logger.error(`[couples-onboarding] Empty response from onboarding agent for chat ${chatId}`)
      await ctx.reply('I\'m having trouble processing your message. Please try again.')
    }
  })
}
