import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { patients } from './patients'
import { therapySessions } from './sessions'

export const artifactTypeValues = [
  'disclosure',
  'insight',
  'emotion',
  'coping_strategy',
  'trigger',
  'goal',
  'pattern',
  'homework',
  'risk_factor',
  'strength',
] as const

export type ArtifactType = (typeof artifactTypeValues)[number]

export const clinicalArtifacts = sqliteTable(
  'clinical_artifacts',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id').notNull().references(() => therapySessions.id),
    patientId: integer('patient_id').references(() => patients.id),
    type: text({ enum: artifactTypeValues }).notNull(),
    content: text().notNull(),
    verbatimQuote: text('verbatim_quote'),
    clinicalRelevance: integer('clinical_relevance').default(5), // 1-10
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  table => [
    index('artifacts_session_id_created_at_idx').on(table.sessionId, table.createdAt),
    index('artifacts_patient_id_created_at_idx').on(table.patientId, table.createdAt),
    index('artifacts_type_idx').on(table.type),
    check('clinical_relevance_range', sql`clinical_relevance >= 1 AND clinical_relevance <= 10`),
  ],
)
