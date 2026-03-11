import type { SessionContext } from '~/agent/context-assembler'
import type { BotContext } from '~/bot/context'
import { join } from 'node:path'
import { extractArtifacts } from '~/agent/artifact-extractor'
import { continueTherapySession, startTherapySession } from '~/agent/therapist'
import { handleOnboardingMessage, isOnboarding, startOnboarding } from '~/bot/handlers/onboarding'
import { detectChatMode } from '~/bot/router'
import { config } from '~/config'
import { createPatient, findPatientByTelegramId } from '~/db/queries/patients'
import { createSession, findActiveSession, saveMessage, updateSessionLastMessage, updateSessionSdkId } from '~/db/queries/sessions'
import { appendMessage, createTranscript } from '~/storage/transcript'

// Debounce buffer for group chats (couples therapy)
const groupBuffer = new Map<
  number,
  { timer: Timer, messages: Array<{ text: string, from: string, patientId?: number }> }
>()

const DEBOUNCE_MS = 20_000

export async function handleMessage(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id
  const chatId = ctx.chat!.id
  const text = ctx.message?.text

  if (!text)
    return

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

  if (chatMode === 'couples') {
    // Buffer messages for group chat debounce
    handleGroupMessage(ctx, chatId, text, patient.id, ctx.from!.first_name || 'Partner')
    return
  }

  // Individual DM — process immediately
  await processTherapyMessage(ctx, chatId, chatMode, [
    { text, from: ctx.from!.first_name || 'Patient', patientId: patient.id },
  ])
}

function handleGroupMessage(
  ctx: BotContext,
  chatId: number,
  text: string,
  patientId: number,
  fromName: string,
): void {
  const existing = groupBuffer.get(chatId)

  const messageEntry = { text, from: fromName, patientId }

  if (existing) {
    clearTimeout(existing.timer)
    existing.messages.push(messageEntry)
  }
  else {
    groupBuffer.set(chatId, { timer: null as any, messages: [messageEntry] })
  }

  const buffer = groupBuffer.get(chatId)!

  // Show typing indicator
  ctx.api.sendChatAction(chatId, 'typing').catch(() => {})

  buffer.timer = setTimeout(async () => {
    const messages = [...buffer.messages]
    groupBuffer.delete(chatId)

    try {
      await processTherapyMessage(ctx, chatId, 'couples', messages)
    }
    catch (err) {
      console.error('Error processing group message:', err)
    }
  }, DEBOUNCE_MS)
}

async function processTherapyMessage(
  ctx: BotContext,
  chatId: number,
  chatMode: 'individual' | 'couples',
  messages: Array<{ text: string, from: string, patientId?: number }>,
): Promise<void> {
  // Show typing indicator
  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(chatId, 'typing').catch(() => {})
  }, 4000)
  ctx.api.sendChatAction(chatId, 'typing').catch(() => {})

  try {
    // Resolve or create active session
    let session = await findActiveSession(chatId)
    const primaryPatientId = messages[0].patientId ?? ctx.session.patientId!
    const telegramId = ctx.from!.id

    if (!session) {
      const transcriptDir
        = chatMode === 'individual'
          ? join('patients', String(telegramId))
          : join('couples', String(chatId))

      const sessionCount = Date.now() // Simple unique ID for path
      const transcriptPath = join(
        config.DATA_DIR,
        transcriptDir,
        'sessions',
        String(sessionCount),
        'transcript.md',
      )

      session = await createSession({
        chatId,
        type: chatMode,
        transcriptPath,
      })

      // Create transcript file
      await createTranscript(transcriptPath, {
        type: chatMode,
        patient:
          chatMode === 'couples'
            ? messages.map(m => m.from).join(' & ')
            : (ctx.from!.username
                ? `@${ctx.from!.username}`
                : ctx.from!.first_name || 'Patient'),
        sessionId: session.id,
        startedAt: new Date(),
      })
    }

    ctx.session.activeSessionId = session.id

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
      })
    }

    // Build session context
    const profilePath = join(
      config.DATA_DIR,
      'patients',
      String(telegramId),
      'PROFILE.md',
    )

    const sessionCtx: SessionContext = {
      sessionId: session.id,
      sessionType: chatMode,
      chatId,
      patientId: primaryPatientId,
      telegramId,
      sdkSessionId: session.sdkSessionId ?? undefined,
      transcriptPath: session.transcriptPath,
      profilePath,
      dataDir: config.DATA_DIR,
    }

    // Call Claude
    let response: string

    if (session.sdkSessionId) {
      response = await continueTherapySession(
        sessionCtx,
        combinedMessage,
        session.sdkSessionId,
      )
    }
    else {
      const result = await startTherapySession(sessionCtx, combinedMessage)
      response = result.response
      await updateSessionSdkId(session.id, result.sdkSessionId)
    }

    // Send response to Telegram
    // Split long messages (Telegram limit is 4096 chars)
    if (response.length <= 4096) {
      await ctx.api.sendMessage(chatId, response)
    }
    else {
      const chunks = splitMessage(response, 4096)
      for (const chunk of chunks) {
        await ctx.api.sendMessage(chatId, chunk)
      }
    }

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

    // Run post-response pipeline async (don't block user)
    extractArtifacts(sessionCtx, combinedMessage, response).catch(err =>
      console.error('Artifact extraction error:', err),
    )
  }
  finally {
    clearInterval(typingInterval)
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    // Try to split at a paragraph break
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen)
    if (splitIdx === -1 || splitIdx < maxLen / 2) {
      // Fall back to splitting at a newline
      splitIdx = remaining.lastIndexOf('\n', maxLen)
    }
    if (splitIdx === -1 || splitIdx < maxLen / 2) {
      // Fall back to splitting at a space
      splitIdx = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitIdx === -1) {
      splitIdx = maxLen
    }

    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}
