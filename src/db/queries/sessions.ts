import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '~/db'
import { sessionMessages, therapySessions } from '~/db/schema'

export async function findActiveSession(chatId: number) {
  const rows = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        eq(therapySessions.chatId, chatId),
        eq(therapySessions.status, 'active'),
      ),
    )
    .orderBy(desc(therapySessions.startedAt))
    .limit(1)
  return rows[0] ?? null
}

export async function createSession(data: {
  chatId: number
  type: 'individual' | 'couples'
  transcriptPath: string
}) {
  const [session] = await db
    .insert(therapySessions)
    .values(data)
    .returning()
  return session
}

export async function updateSessionSdkId(sessionId: number, sdkSessionId: string) {
  await db
    .update(therapySessions)
    .set({ sdkSessionId })
    .where(eq(therapySessions.id, sessionId))
}

export async function updateSessionLastMessage(sessionId: number) {
  const [msgCount] = await db
    .select({ value: count() })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))

  await db
    .update(therapySessions)
    .set({
      lastMessageAt: new Date(),
      messageCount: msgCount.value,
    })
    .where(eq(therapySessions.id, sessionId))
}

export async function updateSessionStatus(
  sessionId: number,
  status: 'active' | 'paused' | 'closed',
) {
  const [updated] = await db
    .update(therapySessions)
    .set({ status })
    .where(eq(therapySessions.id, sessionId))
    .returning()
  return updated
}

export async function saveMessage(data: {
  sessionId: number
  patientId?: number
  role: string
  content: string
}) {
  const [msg] = await db.insert(sessionMessages).values(data).returning()
  return msg
}

export async function getSessionCount(chatId: number) {
  return db
    .select()
    .from(therapySessions)
    .where(eq(therapySessions.chatId, chatId))
    .orderBy(desc(therapySessions.startedAt))
}
