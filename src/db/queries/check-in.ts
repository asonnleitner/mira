import { and, eq, lt, sql } from 'drizzle-orm'
import { db, tables } from '~/db'
import { logger } from '~/telemetry/logger'
import { withDbSpan } from '~/telemetry/tracing'

export async function findOrCreatePreference(chatId: number) {
  const existing = await withDbSpan(
    db.select()
      .from(tables.checkInPreferences)
      .where(eq(tables.checkInPreferences.chatId, chatId))
      .limit(1),
  )

  if (existing[0])
    return existing[0]

  const [created] = await withDbSpan(
    db.insert(tables.checkInPreferences)
      .values({ chatId })
      .returning(),
  )

  return created
}

export async function findSessionsDueForCheckIn() {
  const now = new Date()

  // Get all active sessions with their check-in preferences
  // Both tables now use internal chatId (FK to chats.id)
  const sessions = await withDbSpan(
    db.select({
      sessionId: tables.therapySessions.id,
      chatId: tables.therapySessions.chatId,
      telegramChatId: tables.chats.telegramChatId,
      sessionType: tables.therapySessions.type,
      lastMessageAt: tables.therapySessions.lastMessageAt,
      intervalDays: tables.checkInPreferences.intervalDays,
      unansweredCount: tables.checkInPreferences.unansweredCount,
      lastCheckInAt: tables.checkInPreferences.lastCheckInAt,
    })
      .from(tables.therapySessions)
      .innerJoin(
        tables.checkInPreferences,
        eq(tables.therapySessions.chatId, tables.checkInPreferences.chatId),
      )
      .innerJoin(
        tables.chats,
        eq(tables.therapySessions.chatId, tables.chats.id),
      )
      .where(
        and(
          eq(tables.checkInPreferences.enabled, true),
          lt(tables.checkInPreferences.unansweredCount, 3),
        ),
      ),
  )

  // Filter in JS for interval-based logic (SQLite timestamp math is cleaner this way)
  const result = sessions.filter((s) => {
    const intervalMs = s.intervalDays * 24 * 60 * 60 * 1000
    const cutoff = new Date(now.getTime() - intervalMs)

    // Session must have been inactive for intervalDays
    if (s.lastMessageAt >= cutoff)
      return false

    // Last check-in must be null or older than intervalDays
    if (s.lastCheckInAt && s.lastCheckInAt >= cutoff)
      return false

    return true
  })

  logger.debug(`[db:check-in] findSessionsDueForCheckIn totalActive=${sessions.length} due=${result.length}`)

  return result
}

export async function getPatientInfoForChat(chatId: number) {
  // Use chat_members join to find patients for this internal chatId
  const rows = await withDbSpan(
    db.select({
      firstName: tables.patients.firstName,
      preferredLanguage: tables.patients.preferredLanguage,
    })
      .from(tables.chatMembers)
      .innerJoin(tables.patients, eq(tables.chatMembers.patientId, tables.patients.id))
      .where(eq(tables.chatMembers.chatId, chatId))
      .limit(1),
  )

  return rows[0] ?? null
}

export async function updateLastCheckIn(chatId: number) {
  await withDbSpan(
    db.update(tables.checkInPreferences)
      .set({
        lastCheckInAt: new Date(),
        unansweredCount: sql`${tables.checkInPreferences.unansweredCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(tables.checkInPreferences.chatId, chatId)),
  )
}

export async function resetUnansweredCount(chatId: number) {
  await withDbSpan(
    db.update(tables.checkInPreferences)
      .set({
        unansweredCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(tables.checkInPreferences.chatId, chatId)),
  )
}

export async function updateCheckInPreference(
  chatId: number,
  telegramId: number,
  data: { enabled?: boolean, intervalDays?: number },
) {
  logger.debug(`[db:check-in] updateCheckInPreference chatId=${chatId} enabled=${data.enabled} intervalDays=${data.intervalDays}`)
  const [updated] = await withDbSpan(
    db.update(tables.checkInPreferences)
      .set({
        ...data,
        lastModifiedBy: telegramId,
        updatedAt: new Date(),
      })
      .where(eq(tables.checkInPreferences.chatId, chatId))
      .returning(),
  )

  return updated
}
