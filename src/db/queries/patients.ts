import type { PatientProfile } from '~/db/schema/patients'
import { eq } from 'drizzle-orm'
import { db, tables } from '~/db'
import { withDbSpan } from '~/telemetry/tracing'

export async function findPatientByTelegramId(telegramId: number) {
  const rows = await withDbSpan(
    db.select().from(tables.patients)
      .where(eq(tables.patients.telegramId, telegramId)).limit(1),
  )
  return rows[0] ?? null
}

export async function createPatient(data: {
  telegramId: number
  firstName?: string
  username?: string
}) {
  const [patient] = await withDbSpan(
    db.insert(tables.patients).values(data).returning(),
  )
  return patient
}

export async function completeOnboarding(telegramId: number, profile: PatientProfile) {
  const [updated] = await withDbSpan(
    db.update(tables.patients)
      .set({
        onboardingComplete: true,
        firstName: profile.fullName,
        dateOfBirth: profile.dateOfBirth,
        gender: profile.gender,
        preferredLanguage: profile.preferredLanguage,
        updatedAt: new Date(),
      })
      .where(eq(tables.patients.telegramId, telegramId))
      .returning(),
  )

  return updated
}
