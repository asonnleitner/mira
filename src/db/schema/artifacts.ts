import { index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { patients } from '~/db/schema/patients'
import { therapySessions } from '~/db/schema/sessions'

export const artifactTypeEnum = pgEnum('artifact_type', [
  'disclosure',
  'insight',
  'emotion',
  'coping_strategy',
  'trigger',
  'goal',
  'pattern',
  'homework',
])

export const clinicalArtifacts = pgTable(
  'clinical_artifacts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    sessionId: integer('session_id')
      .notNull()
      .references(() => therapySessions.id),
    patientId: integer('patient_id').references(() => patients.id),
    type: artifactTypeEnum().notNull(),
    content: text().notNull(),
    verbatimQuote: text('verbatim_quote'),
    clinicalRelevance: integer('clinical_relevance').default(5), // 1-10
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  table => [
    index('artifacts_session_id_idx').on(table.sessionId),
    index('artifacts_patient_id_idx').on(table.patientId),
    index('artifacts_type_idx').on(table.type),
  ],
)
