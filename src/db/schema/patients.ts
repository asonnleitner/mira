import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import * as z from 'zod'

export const PatientProfileSchema = z.object({
  fullName: z.string().optional(),
  dateOfBirth: z.iso.date().optional(),
  gender: z.string().optional(),
  occupation: z.string().optional(),
  relationshipStatus: z.string().optional(),
  therapyGoals: z.array(z.string()).optional(),
  previousTherapyExperience: z.string().optional(),
  preferredLanguage: z.string().optional(),
})

export type PatientProfile = z.infer<typeof PatientProfileSchema>

export const patients = sqliteTable('patients', {
  id: integer().primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull().unique(),
  firstName: text('first_name', { length: 256 }),
  username: text({ length: 256 }),
  dateOfBirth: text('date_of_birth', { length: 10 }),
  gender: text({ length: 64 }),
  preferredLanguage: text('preferred_language', { length: 10 }),
  onboardingComplete: integer({ mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})
