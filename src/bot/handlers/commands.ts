import type { BotContext } from '~/bot/context'
import { generateMessage } from '~/agent/messages'
import { startOnboarding } from '~/bot/handlers/onboarding'
import { findPatientByTelegramId } from '~/db/queries/patients'
import { findActiveSession, getSessionCount, updateSessionStatus } from '~/db/queries/sessions'
import { withSpan } from '~/telemetry/tracing'

function getLanguage(ctx: BotContext, patient?: { preferredLanguage?: string | null, profile?: { preferredLanguage?: string } | null } | null): string {
  return patient?.preferredLanguage ?? patient?.profile?.preferredLanguage ?? ctx.from?.language_code ?? 'auto'
}

export async function handleStart(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.start', { 'bot.command': 'start' }, async () => {
    const telegramId = ctx.from!.id
    const patient = await findPatientByTelegramId(telegramId)

    if (!patient || !patient.onboardingComplete) {
      await startOnboarding(ctx)
      return
    }

    ctx.session.patientId = patient.id

    const msg = await generateMessage({
      purpose: 'welcome_back',
      context: { patientName: patient.firstName },
      language: getLanguage(ctx, patient),
    })

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
  })
}

export async function handleStatus(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.status', { 'bot.command': 'status' }, async () => {
    const chatId = ctx.chat!.id
    const patient = await findPatientByTelegramId(ctx.from!.id)
    const session = await findActiveSession(chatId)

    if (!session) {
      const msg = await generateMessage({
        purpose: 'no_active_session',
        language: getLanguage(ctx, patient),
      })
      await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
      return
    }

    const duration = Date.now() - session.startedAt.getTime()
    const minutes = Math.floor(duration / 60_000)

    const msg = await generateMessage({
      purpose: 'session_status',
      context: {
        sessionId: session.id,
        type: session.type,
        status: session.status,
        messageCount: session.messageCount,
        durationMinutes: minutes,
        startedAt: session.startedAt.toISOString(),
      },
      language: getLanguage(ctx, patient),
    })

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
  })
}

export async function handlePause(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.pause', { 'bot.command': 'pause' }, async () => {
    const chatId = ctx.chat!.id
    const patient = await findPatientByTelegramId(ctx.from!.id)
    const session = await findActiveSession(chatId)

    if (!session) {
      const msg = await generateMessage({
        purpose: 'no_active_session',
        context: { action: 'pause' },
        language: getLanguage(ctx, patient),
      })
      await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
      return
    }

    await updateSessionStatus(session.id, 'paused')

    const msg = await generateMessage({
      purpose: 'session_paused',
      language: getLanguage(ctx, patient),
    })

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
  })
}

export async function handleResume(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.resume', { 'bot.command': 'resume' }, async () => {
    const chatId = ctx.chat!.id
    const patient = await findPatientByTelegramId(ctx.from!.id)
    const sessions = await getSessionCount(chatId)
    const paused = sessions.find(s => s.status === 'paused')

    if (!paused) {
      const msg = await generateMessage({
        purpose: 'no_paused_session',
        language: getLanguage(ctx, patient),
      })
      await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
      return
    }

    await updateSessionStatus(paused.id, 'active')
    ctx.session.activeSessionId = paused.id

    const msg = await generateMessage({
      purpose: 'session_resumed',
      language: getLanguage(ctx, patient),
    })

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
  })
}

export async function handleHistory(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.history', { 'bot.command': 'history' }, async () => {
    const chatId = ctx.chat!.id
    const patient = await findPatientByTelegramId(ctx.from!.id)
    const sessions = await getSessionCount(chatId)

    if (sessions.length === 0) {
      const msg = await generateMessage({
        purpose: 'no_history',
        language: getLanguage(ctx, patient),
      })
      await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
      return
    }

    const first = sessions.at(-1)!
    const last = sessions[0]
    const totalMessages = sessions.reduce(
      (sum, s) => sum + (s.messageCount ?? 0),
      0,
    )

    const msg = await generateMessage({
      purpose: 'session_history',
      context: {
        totalSessions: sessions.length,
        totalMessages,
        firstSessionDate: first.startedAt.toISOString().split('T')[0],
        lastSessionDate: last.startedAt.toISOString().split('T')[0],
        activeSessions: sessions.filter(s => s.status === 'active').length,
        pausedSessions: sessions.filter(s => s.status === 'paused').length,
        closedSessions: sessions.filter(s => s.status === 'closed').length,
      },
      language: getLanguage(ctx, patient),
    })

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
  })
}
