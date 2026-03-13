import type { OnboardingType } from '~/db/schema'
import { and, eq } from 'drizzle-orm'
import { db, tables } from '~/db'
import { logger } from '~/telemetry/logger'
import { withDbSpan } from '~/telemetry/tracing'

export async function findOnboarding(
  type: OnboardingType,
  filter: { patientId?: number, chatId?: number },
) {
  const conditions = [
    eq(tables.onboardings.type, type),
    eq(tables.onboardings.status, 'in_progress'),
  ]

  if (filter.patientId != null) {
    conditions.push(eq(tables.onboardings.patientId, filter.patientId))
  }

  if (filter.chatId != null) {
    conditions.push(eq(tables.onboardings.chatId, filter.chatId))
  }

  const rows = await withDbSpan(
    db.select().from(tables.onboardings)
      .where(and(...conditions))
      .limit(1),
  )

  logger.debug(`[db:onboardings] findOnboarding type=${type} patientId=${filter.patientId} chatId=${filter.chatId} found=${!!rows[0]}`)

  return rows[0] ?? null
}

export async function createOnboarding(
  type: OnboardingType,
  filter: { patientId?: number, chatId?: number },
) {
  const [onboarding] = await withDbSpan(
    db.insert(tables.onboardings)
      .values({
        type,
        patientId: filter.patientId,
        chatId: filter.chatId,
      })
      .returning(),
  )

  logger.debug(`[db:onboardings] createOnboarding id=${onboarding.id} type=${type} patientId=${filter.patientId} chatId=${filter.chatId}`)

  return onboarding
}

export async function updateOnboardingSdkSessionId(onboardingId: number, sdkSessionId: string) {
  await withDbSpan(
    db.update(tables.onboardings)
      .set({ sdkSessionId, updatedAt: new Date() })
      .where(eq(tables.onboardings.id, onboardingId)),
  )

  logger.debug(`[db:onboardings] updateOnboardingSdkSessionId id=${onboardingId}`)
}

export async function completeOnboarding(onboardingId: number) {
  await withDbSpan(
    db.update(tables.onboardings)
      .set({
        status: 'complete',
        sdkSessionId: null,
        updatedAt: new Date(),
      })
      .where(eq(tables.onboardings.id, onboardingId)),
  )

  logger.debug(`[db:onboardings] completeOnboarding id=${onboardingId}`)
}
