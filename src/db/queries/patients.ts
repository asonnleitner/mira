import type { PatientProfile } from '~/db/schema'
import { eq } from 'drizzle-orm'
import { db, tables } from '~/db'

export async function findPatientByTelegramId(telegramId: number) {
  const rows = await db
    .select()
    .from(tables.patients)
    .where(eq(tables.patients.telegramId, telegramId))
    .limit(1)
  return rows[0] ?? null
}

export async function createPatient(data: {
  telegramId: number
  firstName?: string
  username?: string
}) {
  const [patient] = await db.insert(tables.patients).values(data).returning()
  return patient
}

export async function updatePatientProfile(
  telegramId: number,
  profile: Partial<PatientProfile>,
) {
  const existing = await findPatientByTelegramId(telegramId)
  if (!existing)
    return null

  const merged = { ...(existing.profile ?? {}), ...profile }
  const [updated] = await db
    .update(tables.patients)
    .set({ profile: merged, updatedAt: new Date() })
    .where(eq(tables.patients.telegramId, telegramId))
    .returning()
  return updated
}

export async function completeOnboarding(
  telegramId: number,
  profile: PatientProfile,
) {
  const [updated] = await db
    .update(tables.patients)
    .set({
      onboardingComplete: true,
      firstName: profile.fullName,
      age: profile.age,
      profile,
      updatedAt: new Date(),
    })
    .where(eq(tables.patients.telegramId, telegramId))
    .returning()
  return updated
}
