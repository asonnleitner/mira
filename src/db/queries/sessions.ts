import type { SessionStatus, SessionType } from '~/db/schema'
import type { InsertMessage } from '~/db/zod'
import { and, count, desc, eq } from 'drizzle-orm'
import { db, tables } from '~/db'

export async function findActiveSession(chatId: number) {
  const rows = await db
    .select()
    .from(tables.therapySessions)
    .where(
      and(
        eq(tables.therapySessions.chatId, chatId),
        eq(tables.therapySessions.status, 'active'),
      ),
    )
    .orderBy(desc(tables.therapySessions.startedAt))
    .limit(1)
  return rows[0] ?? null
}

export async function createSession(data: {
  chatId: number
  type: SessionType
  transcriptPath: string
}) {
  const [session] = await db
    .insert(tables.therapySessions)
    .values(data)
    .returning()
  return session
}

export async function updateSessionSdkId(sessionId: number, sdkSessionId: string) {
  await db
    .update(tables.therapySessions)
    .set({ sdkSessionId })
    .where(eq(tables.therapySessions.id, sessionId))
}

export async function updateSessionLastMessage(sessionId: number) {
  const [msgCount] = await db
    .select({ value: count() })
    .from(tables.sessionMessages)
    .where(eq(tables.sessionMessages.sessionId, sessionId))

  await db
    .update(tables.therapySessions)
    .set({
      lastMessageAt: new Date(),
      messageCount: msgCount.value,
    })
    .where(eq(tables.therapySessions.id, sessionId))
}

export async function updateSessionStatus(
  sessionId: number,
  status: SessionStatus,
) {
  const [updated] = await db
    .update(tables.therapySessions)
    .set({ status })
    .where(eq(tables.therapySessions.id, sessionId))
    .returning()
  return updated
}

export async function saveMessage(data: Pick<InsertMessage, 'sessionId' | 'patientId' | 'role' | 'content'>) {
  const [msg] = await db.insert(tables.sessionMessages).values(data).returning()
  return msg
}

export async function getSessionCount(chatId: number) {
  return db
    .select()
    .from(tables.therapySessions)
    .where(eq(tables.therapySessions.chatId, chatId))
    .orderBy(desc(tables.therapySessions.startedAt))
}
