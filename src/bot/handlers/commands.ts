import type { BotContext } from '~/bot/context'
import { generateMessage } from '~/agent/messages'
import { startOnboarding } from '~/bot/handlers/onboarding'
import { replyMarkdownV2 } from '~/bot/utils/telegram-send'
import { ATTR_BOT_COMMAND } from '~/constants'
import { findOrCreatePreference } from '~/db/queries/check-in'
import { findPatientByTelegramId } from '~/db/queries/patients'
import { findActiveSession, getSessionCount, updateSessionStatus } from '~/db/queries/sessions'
import { logger } from '~/telemetry/logger'
import { withSpan } from '~/telemetry/tracing'

function getLanguage(ctx: BotContext, patient?: { preferredLanguage?: string | null } | null): string {
  return patient?.preferredLanguage ?? ctx.from?.language_code ?? 'auto'
}

export async function handleStart(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.start', { [ATTR_BOT_COMMAND]: 'start' }, async () => {
    const telegramId = ctx.from!.id

    logger.debug(`[commands] /start from telegramId=${telegramId}`)

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

    logger.info(`[start] Generated welcome message for ${telegramId} (${msg.length} chars)`)

    await replyMarkdownV2(ctx, msg)
  })
}

export async function handleStatus(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.status', { [ATTR_BOT_COMMAND]: 'status' }, async () => {
    const chatId = ctx.chat!.id

    logger.debug(`[commands] /status from chatId=${chatId}`)

    const patient = await findPatientByTelegramId(ctx.from!.id)
    const session = await findActiveSession(chatId)

    if (!session) {
      const msg = await generateMessage({
        purpose: 'no_active_session',
        language: getLanguage(ctx, patient),
      })

      await replyMarkdownV2(ctx, msg)
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

    await replyMarkdownV2(ctx, msg)
  })
}

export async function handlePause(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.pause', { [ATTR_BOT_COMMAND]: 'pause' }, async () => {
    const chatId = ctx.chat!.id

    logger.debug(`[commands] /pause from chatId=${chatId}`)

    const patient = await findPatientByTelegramId(ctx.from!.id)
    const session = await findActiveSession(chatId)

    if (!session) {
      const msg = await generateMessage({
        purpose: 'no_active_session',
        context: { action: 'pause' },
        language: getLanguage(ctx, patient),
      })

      await replyMarkdownV2(ctx, msg)
      return
    }

    await updateSessionStatus(session.id, 'paused')

    const msg = await generateMessage({
      purpose: 'session_paused',
      language: getLanguage(ctx, patient),
    })

    await replyMarkdownV2(ctx, msg)
  })
}

export async function handleResume(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.resume', { [ATTR_BOT_COMMAND]: 'resume' }, async () => {
    const chatId = ctx.chat!.id

    logger.debug(`[commands] /resume from chatId=${chatId}`)

    const patient = await findPatientByTelegramId(ctx.from!.id)
    const sessions = await getSessionCount(chatId)
    const paused = sessions.find(s => s.status === 'paused')

    if (!paused) {
      const msg = await generateMessage({
        purpose: 'no_paused_session',
        language: getLanguage(ctx, patient),
      })
      await replyMarkdownV2(ctx, msg)
      return
    }

    await updateSessionStatus(paused.id, 'active')
    ctx.session.activeSessionId = paused.id

    const msg = await generateMessage({
      purpose: 'session_resumed',
      language: getLanguage(ctx, patient),
    })

    await replyMarkdownV2(ctx, msg)
  })
}

export async function handleHistory(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.history', { [ATTR_BOT_COMMAND]: 'history' }, async () => {
    const chatId = ctx.chat!.id

    logger.debug(`[commands] /history from chatId=${chatId}`)

    const patient = await findPatientByTelegramId(ctx.from!.id)
    const sessions = await getSessionCount(chatId)

    if (sessions.length === 0) {
      const msg = await generateMessage({
        purpose: 'no_history',
        language: getLanguage(ctx, patient),
      })

      await replyMarkdownV2(ctx, msg)
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

    await replyMarkdownV2(ctx, msg)
  })
}

export async function handleCheckIn(ctx: BotContext): Promise<void> {
  await withSpan('bot.command.checkin', { [ATTR_BOT_COMMAND]: 'checkin' }, async () => {
    const chatId = ctx.chat!.id

    logger.debug(`[commands] /checkin from chatId=${chatId}`)

    const pref = await findOrCreatePreference(chatId)

    ctx.session.checkInEnabled = pref.enabled
    ctx.session.checkInIntervalDays = pref.intervalDays

    const status = pref.enabled
      ? `Check\\-ins are *enabled* every *${pref.intervalDays} day\\(s\\)*\\.`
      : 'Check\\-ins are currently *disabled*\\.'

    const { checkInMenu } = await import('~/bot/menus/check-in')

    await ctx.reply(status, {
      parse_mode: 'MarkdownV2',
      reply_markup: checkInMenu,
    })
  })
}
