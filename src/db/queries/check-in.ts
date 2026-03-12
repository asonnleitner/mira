import { and, eq, lt, sql } from 'drizzle-orm'
import { db, tables } from '~/db'
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
  const sessions = await withDbSpan(
    db.select({
      sessionId: tables.therapySessions.id,
      chatId: tables.therapySessions.chatId,
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
      .where(
        and(
          eq(tables.therapySessions.status, 'active'),
          eq(tables.checkInPreferences.enabled, true),
          lt(tables.checkInPreferences.unansweredCount, 3),
        ),
      ),
  )

  // Filter in JS for interval-based logic (SQLite timestamp math is cleaner this way)
  return sessions.filter((s) => {
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
}

export async function getPatientInfoForChat(chatId: number) {
  // Find patient(s) associated with this chatId via sessions and messages
  // For individual chats, chatId = telegramId for private chats
  // Look up patients who have sent messages in sessions for this chat
  const rows = await withDbSpan(
    db.select({
      firstName: tables.patients.firstName,
      preferredLanguage: tables.patients.preferredLanguage,
    })
      .from(tables.patients)
      .where(eq(tables.patients.telegramId, chatId))
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
