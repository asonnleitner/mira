import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod'
import * as z from 'zod'
import { clinicalArtifacts } from './schema/artifacts'
import { sessionMessages } from './schema/messages'
import { patients } from './schema/patients'
import { therapySessions } from './schema/sessions'

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

// ---------------------------------------------------------------------------
// Derived insert types (for query function params)
// ---------------------------------------------------------------------------

export type InsertArtifact = z.infer<typeof insertArtifactSchema>
export type InsertSession = z.infer<typeof insertSessionSchema>
export type InsertMessage = z.infer<typeof insertMessageSchema>
export type InsertPatient = z.infer<typeof insertPatientSchema>

// ---------------------------------------------------------------------------
// SOAP note schema (shared between artifact-extractor and storage)
// ---------------------------------------------------------------------------

export const soapSchema = z.object({
  subjective: z.array(z.string()),
  objective: z.array(z.string()),
  assessment: z.array(z.string()),
  plan: z.array(z.string()),
})

export type SoapNote = z.infer<typeof soapSchema>
