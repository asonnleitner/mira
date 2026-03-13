import type { ChatType } from '~/db/schema'
import { eq } from 'drizzle-orm'
import { db, tables } from '~/db'
import { logger } from '~/telemetry/logger'
import { withDbSpan } from '~/telemetry/tracing'

export async function findChatByTelegramChatId(telegramChatId: number) {
  const rows = await withDbSpan(
    db.select().from(tables.chats)
      .where(eq(tables.chats.telegramChatId, telegramChatId)).limit(1),
  )

  logger.debug(`[db:chats] findChatByTelegramChatId telegramChatId=${telegramChatId} found=${!!rows[0]}`)

  return rows[0] ?? null
}

export async function findOrCreateChat(telegramChatId: number, type: ChatType) {
  const existing = await findChatByTelegramChatId(telegramChatId)

  if (existing)
    return existing

  const [created] = await withDbSpan(
    db.insert(tables.chats)
      .values({ telegramChatId, type })
      .returning(),
  )

  logger.debug(`[db:chats] findOrCreateChat created chatId=${created.id} telegramChatId=${telegramChatId} type=${type}`)

  return created
}

export async function addChatMember(chatId: number, patientId: number) {
  const [member] = await withDbSpan(
    db.insert(tables.chatMembers)
      .values({ chatId, patientId })
      .onConflictDoNothing()
      .returning(),
  )

  if (member) {
    logger.debug(`[db:chats] addChatMember chatId=${chatId} patientId=${patientId} (new)`)
  }

  return member
}

export async function getChatMembers(chatId: number) {
  const rows = await withDbSpan(
    db.select({
      patientId: tables.chatMembers.patientId,
      firstName: tables.patients.firstName,
      telegramId: tables.patients.telegramId,
      preferredLanguage: tables.patients.preferredLanguage,
    })
      .from(tables.chatMembers)
      .innerJoin(tables.patients, eq(tables.chatMembers.patientId, tables.patients.id))
      .where(eq(tables.chatMembers.chatId, chatId)),
  )

  logger.debug(`[db:chats] getChatMembers chatId=${chatId} count=${rows.length}`)

  return rows
}
