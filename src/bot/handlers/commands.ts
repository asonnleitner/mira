import type { BotContext } from '~/bot/context'
import { startOnboarding } from '~/bot/handlers/onboarding'
import { findPatientByTelegramId } from '~/db/queries/patients'
import { findActiveSession, getSessionCount, updateSessionStatus } from '~/db/queries/sessions'

export async function handleStart(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id
  const patient = await findPatientByTelegramId(telegramId)

  if (!patient || !patient.onboardingComplete) {
    await startOnboarding(ctx)
    return
  }

  ctx.session.patientId = patient.id

  const lang = patient.profile?.preferredLanguage
  const msg = lang === 'cs'
    ? `Vitejte zpet, ${patient.firstName || ''}! Jsem tu pro vas. Napiste mi cokoliv, co mate na srdci.`
    : `Welcome back, ${patient.firstName || ''}! I'm here for you. Write me anything that's on your mind.`

  await ctx.reply(msg)
}

export async function handleStatus(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat!.id
  const session = await findActiveSession(chatId)

  if (!session) {
    await ctx.reply('No active session. Send a message to start one.')
    return
  }

  const duration = Date.now() - session.startedAt.getTime()
  const minutes = Math.floor(duration / 60_000)

  await ctx.reply(
    `Session #${session.id}\n`
    + `Type: ${session.type}\n`
    + `Status: ${session.status}\n`
    + `Messages: ${session.messageCount}\n`
    + `Duration: ${minutes} minutes\n`
    + `Started: ${session.startedAt.toISOString()}`,
  )
}

export async function handlePause(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat!.id
  const session = await findActiveSession(chatId)

  if (!session) {
    await ctx.reply('No active session to pause.')
    return
  }

  await updateSessionStatus(session.id, 'paused')
  await ctx.reply(
    'Session paused. Use /resume when you\'re ready to continue.',
  )
}

export async function handleResume(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat!.id

  // Find most recent paused session
  const sessions = await getSessionCount(chatId)
  const paused = sessions.find(s => s.status === 'paused')

  if (!paused) {
    await ctx.reply('No paused session found. Send a message to start a new one.')
    return
  }

  await updateSessionStatus(paused.id, 'active')
  ctx.session.activeSessionId = paused.id
  await ctx.reply('Session resumed. I\'m here whenever you\'re ready.')
}

export async function handleHistory(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat!.id
  const sessions = await getSessionCount(chatId)

  if (sessions.length === 0) {
    await ctx.reply('No session history yet.')
    return
  }

  const first = sessions.at(-1)!
  const last = sessions[0]
  const totalMessages = sessions.reduce(
    (sum, s) => sum + (s.messageCount ?? 0),
    0,
  )

  await ctx.reply(
    `Session History\n`
    + `Total sessions: ${sessions.length}\n`
    + `Total messages: ${totalMessages}\n`
    + `First session: ${first.startedAt.toISOString().split('T')[0]}\n`
    + `Last session: ${last.startedAt.toISOString().split('T')[0]}\n`
    + `Active: ${sessions.filter(s => s.status === 'active').length}\n`
    + `Paused: ${sessions.filter(s => s.status === 'paused').length}\n`
    + `Closed: ${sessions.filter(s => s.status === 'closed').length}`,
  )
}
