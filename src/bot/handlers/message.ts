import type { SpanContext } from '@opentelemetry/api'
import type { SessionContext } from '~/agent/context-assembler'
import type { BotContext } from '~/bot/context'
import type { SessionType } from '~/db/schema'
import { runNoteTaker } from '~/agent/note-taker'
import { continueTherapySession, isStaleSessionError, startTherapySession } from '~/agent/therapist'
import { handleCouplesOnboardingMessage, isCouplesOnboarding, startCouplesOnboarding } from '~/bot/handlers/couples-onboarding'
import { handleOnboardingMessage, isOnboarding, startOnboarding } from '~/bot/handlers/onboarding'
import { detectChatMode } from '~/bot/router'
import { sendMarkdownV2 } from '~/bot/utils/telegram-send'
import { config } from '~/config'
import { ATTR_BOT_CHAT_MODE, ATTR_BOT_MESSAGE_COUNT, ATTR_TELEGRAM_CHAT_ID } from '~/constants'
import { addChatMember, findOrCreateChat } from '~/db/queries/chats'
import { resetUnansweredCount } from '~/db/queries/check-in'
import { createPatient, findPatientByTelegramId } from '~/db/queries/patients'
import { createSession, findActiveSession, saveMessage, updateSessionLastMessage, updateSessionSdkId } from '~/db/queries/sessions'
import { patientProfilePath, relationshipProfilePath, sessionTranscriptPath } from '~/paths'
import { appendMessage, createTranscript } from '~/storage/transcript'
import { logger } from '~/telemetry/logger'
import { captureSpanContext, withLinkedSpan } from '~/telemetry/tracing'

interface MessageEntry {
  text: string
  from: string
  patientId?: number
  senderTelegramId: number
}

interface ChatBuffer {
  messages: MessageEntry[]
  spanContexts: SpanContext[]
  abortController?: AbortController
  ctx: BotContext
  chatMode: SessionType
}

// Unified buffer for both individual and couples chats
const chatBuffer = new Map<number, ChatBuffer>()

export async function handleMessage(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id
  const chatId = ctx.chat!.id
  const text = ctx.message?.text

  if (!text)
    return

  const chatType = ctx.chat?.type

  logger.debug(`[message] Incoming: telegramId=${telegramId} chatId=${chatId} chatType=${chatType}`)

  // In groups, only respond when the bot is explicitly mentioned or replied to
  if (chatType === 'group' || chatType === 'supergroup') {
    const botMentioned = ctx.message?.text?.includes(`@${ctx.me.username}`)
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.me.id

    if (!botMentioned && !isReplyToBot) {
      logger.debug(`[message] Ignoring group message in chat ${chatId} (not mentioned/replied)`)
      return
    }
  }

  // Check onboarding state
  if (isOnboarding(telegramId)) {
    await handleOnboardingMessage(ctx)
    return
  }

  // Ensure patient exists
  let patient = await findPatientByTelegramId(telegramId)

  if (!patient) {
    patient = await createPatient({
      telegramId,
      firstName: ctx.from!.first_name,
      username: ctx.from!.username,
    })
  }

  if (!patient.onboardingComplete) {
    await startOnboarding(ctx)
    return
  }

  ctx.session.patientId = patient.id

  const chatMode = detectChatMode(ctx)

  // Couples onboarding gate: check before message buffering
  if (chatMode === 'couples') {
    if (isCouplesOnboarding(chatId)) {
      await handleCouplesOnboardingMessage(ctx)
      return
    }

    const relationshipPath = relationshipProfilePath(chatId)
    const relationshipExists = await Bun.file(relationshipPath).exists()

    if (!relationshipExists) {
      await startCouplesOnboarding(ctx)
      return
    }
  }

  // Resolve internal chat entity
  const chat = await findOrCreateChat(chatId, chatMode)

  // Ensure chat membership
  await addChatMember(chat.id, patient.id)

  // Reset unanswered check-in count on any user message (using internal chatId)
  resetUnansweredCount(chat.id).catch(() => {})

  const messageEntry: MessageEntry = {
    text,
    from: ctx.from!.first_name || (chatMode === 'couples' ? 'Partner' : 'Patient'),
    patientId: patient.id,
    senderTelegramId: telegramId,
  }

  const spanContext = captureSpanContext()

  bufferMessage(ctx, chatId, chat.id, chatMode, messageEntry, spanContext)
}

function bufferMessage(ctx: BotContext, telegramChatId: number, internalChatId: number, chatMode: SessionType, message: MessageEntry, spanContext?: SpanContext): void {
  const existing = chatBuffer.get(telegramChatId)

  if (existing) {
    // Abort in-flight request if one is running
    if (existing.abortController) {
      logger.debug(`[message] Aborting in-flight request for chat ${telegramChatId}, buffering new message`)
      existing.abortController.abort()
      existing.abortController = undefined
    }

    existing.messages.push(message)

    if (spanContext)
      existing.spanContexts.push(spanContext)

    existing.ctx = ctx // Use latest ctx for reply
  }
  else {
    chatBuffer.set(telegramChatId, {
      messages: [message],
      spanContexts: spanContext ? [spanContext] : [],
      ctx,
      chatMode,
    })
  }

  const buffer = chatBuffer.get(telegramChatId)!

  // Show typing indicator
  ctx.api.sendChatAction(telegramChatId, 'typing').catch(() => {})

  // Process immediately
  const ac = new AbortController()

  buffer.abortController = ac

  const messages = [...buffer.messages]
  const links = buffer.spanContexts.map(sc => ({ context: sc }))

  buffer.messages = []
  buffer.spanContexts = []

  void (async () => {
    try {
      await withLinkedSpan('bot.processTherapyMessage', {
        [ATTR_TELEGRAM_CHAT_ID]: telegramChatId,
        [ATTR_BOT_CHAT_MODE]: chatMode,
        [ATTR_BOT_MESSAGE_COUNT]: messages.length,
      }, links, async () => {
        await processTherapyMessage(buffer.ctx, telegramChatId, internalChatId, chatMode, messages, ac.signal)
      })

      chatBuffer.delete(telegramChatId)
    }
    catch (err) {
      if (ac.signal.aborted)
        return

      logger.error(`[message] Error processing therapy message for chat ${telegramChatId}:`, err)
      // Notify user that something went wrong
      ctx.api.sendMessage(telegramChatId, 'Sorry, something went wrong. Please try again.').catch(() => {})

      chatBuffer.delete(telegramChatId)
    }
  })()
}

async function processTherapyMessage(
  ctx: BotContext,
  telegramChatId: number,
  internalChatId: number,
  chatMode: SessionType,
  messages: MessageEntry[],
  signal: AbortSignal,
): Promise<void> {
  // Show typing indicator
  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(telegramChatId, 'typing').catch(() => {})
  }, 4000)

  ctx.api.sendChatAction(telegramChatId, 'typing').catch(() => {})

  try {
    // Resolve or create active session (using internal chatId)
    let session = await findActiveSession(internalChatId)

    const primaryPatientId = messages[0].patientId ?? ctx.session.patientId!
    const telegramId = ctx.from!.id

    if (!session) {
      const sessionCount = Date.now() // Simple unique ID for path

      const transcriptPath = sessionTranscriptPath(
        chatMode,
        chatMode === 'individual' ? telegramId : telegramChatId,
        sessionCount,
      )

      session = await createSession({
        chatId: internalChatId,
        type: chatMode,
        transcriptPath,
      })

      // Create transcript file
      await createTranscript(transcriptPath, {
        type: chatMode,
        patient: chatMode === 'couples'
          ? messages.map(m => m.from).join(' & ')
          : (ctx.from!.username ? `@${ctx.from!.username}` : ctx.from!.first_name || 'Patient'),
        sessionId: session.id,
        startedAt: new Date(),
      })
    }

    ctx.session.activeSessionId = session.id

    logger.debug(`[message] Session resolved: chatId=${internalChatId} sessionId=${session.id} isNew=${!session.sdkSessionId}`)

    // Compose patient message (batch for couples)
    let combinedMessage: string

    if (messages.length === 1) {
      combinedMessage = messages[0].text
    }
    else {
      combinedMessage = messages
        .map(m => `[${m.from}]: ${m.text}`)
        .join('\n\n')
    }

    // Append patient message(s) to transcript and DB
    for (const msg of messages) {
      await appendMessage(
        session.transcriptPath,
        'Patient',
        msg.text,
        new Date(),
        messages.length > 1 ? msg.from : undefined,
      )

      await saveMessage({
        sessionId: session.id,
        patientId: msg.patientId,
        role: 'patient',
        content: msg.text,
        senderTelegramId: msg.senderTelegramId,
      })
    }

    // Check abort before calling Claude (messages already saved)
    if (signal.aborted)
      throw new DOMException('Aborted', 'AbortError')

    logger.debug(`[message] Calling Claude: chatId=${internalChatId} sessionId=${session.id} mode=${chatMode} resume=${!!session.sdkSessionId}`)

    // Build session context
    const profilePath = chatMode === 'individual'
      ? patientProfilePath(telegramId)
      : relationshipProfilePath(telegramChatId)

    // Resolve preferred language from patient record
    const patient = await findPatientByTelegramId(telegramId)

    const sessionCtx: SessionContext = {
      sessionId: session.id,
      sessionType: chatMode,
      chatId: internalChatId,
      telegramChatId,
      patientId: primaryPatientId,
      telegramId,
      preferredLanguage: patient?.preferredLanguage ?? undefined,
      sdkSessionId: session.sdkSessionId ?? undefined,
      transcriptPath: session.transcriptPath,
      profilePath,
      dataDir: config.DATA_DIR,
    }

    // Create AbortController to pass to SDK
    const sdkAbortController = new AbortController()

    signal.addEventListener('abort', () => sdkAbortController.abort(), { once: true })

    // Call Claude
    let response: string

    if (session.sdkSessionId) {
      try {
        response = await continueTherapySession(
          sessionCtx,
          combinedMessage,
          session.sdkSessionId,
          sdkAbortController,
        )
      }
      catch (err) {
        if (isStaleSessionError(err)) {
          logger.warn(`[message] Stale SDK session ${session.sdkSessionId}, starting fresh session`)
          await updateSessionSdkId(session.id, null)
          const result = await startTherapySession(sessionCtx, combinedMessage, sdkAbortController)
          response = result.response
          await updateSessionSdkId(session.id, result.sdkSessionId)
        }
        else {
          throw err
        }
      }
    }
    else {
      const result = await startTherapySession(sessionCtx, combinedMessage, sdkAbortController)
      response = result.response
      await updateSessionSdkId(session.id, result.sdkSessionId)
    }

    // Check abort after Claude returns (before sending response)
    if (signal.aborted)
      throw new DOMException('Aborted', 'AbortError')

    // Warn if agent returned an empty response
    if (!response)
      logger.warn(`[message] Empty response from agent for chat ${telegramChatId}`)

    // Send response to Telegram (uses raw Telegram chat ID)
    logger.info(`[message] Sending response to chat ${telegramChatId} (${response.length} chars)`)

    await sendMarkdownV2({ chatId: telegramChatId, text: response, api: ctx.api })

    // Append therapist response to transcript and DB
    await appendMessage(
      session.transcriptPath,
      'Therapist',
      response,
      new Date(),
    )

    await saveMessage({
      sessionId: session.id,
      role: 'therapist',
      content: response,
    })

    // Update session metadata
    await updateSessionLastMessage(session.id)

    // Run note-taker async (don't block user)
    logger.debug(`[message] Note-taker dispatched for session ${session.id}`)

    runNoteTaker(sessionCtx, combinedMessage, response).catch(err =>
      logger.error('[message] Note-taker error:', err),
    )
  }
  finally {
    clearInterval(typingInterval)
  }
}
