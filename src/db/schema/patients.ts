import { bigint, boolean, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'
import * as z from 'zod'

export const patientProfileSchema = z.object({
  fullName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  occupation: z.string().optional(),
  relationshipStatus: z.string().optional(),
  therapyGoals: z.array(z.string()).optional(),
  previousTherapyExperience: z.string().optional(),
  preferredLanguage: z.string().optional(),
  attachmentStyle: z.string().optional(),
  recurringThemes: z.array(z.object({
    theme: z.string(),
    frequency: z.number(),
    trend: z.string(),
  })).optional(),
  copingPatterns: z.array(z.string()).optional(),
  triggers: z.array(z.string()).optional(),
  progressNotes: z.array(z.object({
    date: z.string(),
    note: z.string(),
  })).optional(),
})

export type PatientProfile = z.infer<typeof patientProfileSchema>

export const patients = pgTable('patients', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  firstName: varchar('first_name', { length: 256 }),
  username: varchar({ length: 256 }),
  dateOfBirth: varchar('date_of_birth', { length: 10 }),
  onboardingComplete: boolean('onboarding_complete').default(false).notNull(),
  profile: jsonb('profile').$type<PatientProfile>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
