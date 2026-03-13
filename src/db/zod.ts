import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod'
import * as z from 'zod'
import { chatMembers, chats, checkInPreferences, clinicalArtifacts, onboardings, patients, sessionMessages, therapySessions } from '~/db/schema'

// ---------------------------------------------------------------------------
// Drizzle-derived Zod schemas
// ---------------------------------------------------------------------------

export const insertArtifactSchema = createInsertSchema(clinicalArtifacts)
export const selectArtifactSchema = createSelectSchema(clinicalArtifacts)

export const insertSessionSchema = createInsertSchema(therapySessions)
export const selectSessionSchema = createSelectSchema(therapySessions)

export const insertMessageSchema = createInsertSchema(sessionMessages)
export const selectMessageSchema = createSelectSchema(sessionMessages)

export const insertPatientSchema = createInsertSchema(patients)
export const selectPatientSchema = createSelectSchema(patients)

export const insertCheckInPreferenceSchema = createInsertSchema(checkInPreferences)
export const selectCheckInPreferenceSchema = createSelectSchema(checkInPreferences)

export const insertChatSchema = createInsertSchema(chats)
export const selectChatSchema = createSelectSchema(chats)

export const insertChatMemberSchema = createInsertSchema(chatMembers)
export const selectChatMemberSchema = createSelectSchema(chatMembers)

export const insertOnboardingSchema = createInsertSchema(onboardings)
export const selectOnboardingSchema = createSelectSchema(onboardings)

// ---------------------------------------------------------------------------
// Derived insert types (for query function params)
// ---------------------------------------------------------------------------

export type InsertArtifact = z.infer<typeof insertArtifactSchema>
export type InsertSession = z.infer<typeof insertSessionSchema>
export type InsertMessage = z.infer<typeof insertMessageSchema>
export type InsertPatient = z.infer<typeof insertPatientSchema>
export type InsertCheckInPreference = z.infer<typeof insertCheckInPreferenceSchema>
export type InsertChat = z.infer<typeof insertChatSchema>
export type InsertChatMember = z.infer<typeof insertChatMemberSchema>
export type InsertOnboarding = z.infer<typeof insertOnboardingSchema>

// ---------------------------------------------------------------------------
// SOAP note schema (shared between note-taker and storage)
// ---------------------------------------------------------------------------

export const soapSchema = z.object({
  subjective: z.array(z.string()),
  objective: z.array(z.string()),
  assessment: z.array(z.string()),
  plan: z.array(z.string()),
})

export type SoapNote = z.infer<typeof soapSchema>
