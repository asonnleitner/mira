import type { SessionType } from '~/db/schema'
import type { InsertMessage } from '~/db/zod'
import { count, desc, eq } from 'drizzle-orm'
import { db, tables } from '~/db'
import { logger } from '~/telemetry/logger'
import { withDbSpan } from '~/telemetry/tracing'

export async function findActiveSession(chatId: number) {
  const rows = await withDbSpan(
    db.select()
      .from(tables.therapySessions)
      .where(eq(tables.therapySessions.chatId, chatId))
      .orderBy(desc(tables.therapySessions.startedAt))
      .limit(1),
  )

  logger.debug(`[db:sessions] findActiveSession chatId=${chatId} found=${!!rows[0]}`)

  return rows[0] ?? null
}

export async function createSession(data: {
  chatId: number
  type: SessionType
  transcriptPath: string
}) {
  const [session] = await withDbSpan(
    db.insert(tables.therapySessions)
      .values(data)
      .returning(),
  )

  logger.debug(`[db:sessions] createSession chatId=${data.chatId} type=${data.type} sessionId=${session.id}`)

  return session
}

export async function updateSessionSdkId(sessionId: number, sdkSessionId: string | null) {
  logger.debug(`[db:sessions] updateSessionSdkId sessionId=${sessionId} hasSdkId=${!!sdkSessionId}`)
  await withDbSpan(
    db.update(tables.therapySessions)
      .set({ sdkSessionId })
      .where(eq(tables.therapySessions.id, sessionId)),
  )
}

export async function updateSessionLastMessage(sessionId: number) {
  const [msgCount] = await withDbSpan(
    db.select({ value: count() })
      .from(tables.sessionMessages)
      .where(eq(tables.sessionMessages.sessionId, sessionId)),
  )

  await withDbSpan(
    db.update(tables.therapySessions)
      .set({
        lastMessageAt: new Date(),
        messageCount: msgCount.value,
      })
      .where(eq(tables.therapySessions.id, sessionId)),
  )
}

export async function saveMessage(data: Pick<InsertMessage, 'sessionId' | 'patientId' | 'role' | 'content' | 'senderTelegramId'>) {
  const [msg] = await withDbSpan(
    db.insert(tables.sessionMessages).values(data).returning(),
  )
  return msg
}
