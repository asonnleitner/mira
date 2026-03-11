import { bigint, boolean, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

export interface PatientProfile {
  fullName?: string
  age?: number
  gender?: string
  occupation?: string
  relationshipStatus?: string
  therapyGoals?: string[]
  previousTherapyExperience?: string
  preferredLanguage?: 'en' | 'cs'
  attachmentStyle?: string
  recurringThemes?: Array<{
    theme: string
    frequency: number
    trend: string
  }>
  copingPatterns?: string[]
  triggers?: string[]
  progressNotes?: Array<{ date: string, note: string }>
}

export const patients = pgTable('patients', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  firstName: varchar('first_name', { length: 256 }),
  username: varchar({ length: 256 }),
  age: integer('age'),
  onboardingComplete: boolean('onboarding_complete').default(false).notNull(),
  profile: jsonb('profile').$type<PatientProfile>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
