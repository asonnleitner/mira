import type { PatientProfile } from '~/db/schema/patients'
import { defineRelations } from 'drizzle-orm'
import { artifactTypeEnum, clinicalArtifacts } from '~/db/schema/artifacts'
import { grammySessions } from '~/db/schema/grammy-sessions'
import { sessionMessages } from '~/db/schema/messages'
import { patients } from '~/db/schema/patients'
import { sessionStatusEnum, sessionTypeEnum, therapySessions } from '~/db/schema/sessions'

export type { PatientProfile }

export const schema = {
  artifactTypeEnum,
  clinicalArtifacts,
  grammySessions,
  patients,
  sessionMessages,
  sessionStatusEnum,
  sessionTypeEnum,
  therapySessions,
}

export const relations = defineRelations(
  { patients, therapySessions, sessionMessages, clinicalArtifacts },
  ({ one, many, patients, therapySessions, sessionMessages, clinicalArtifacts }) => ({
    patients: {
      messages: many.sessionMessages(),
      artifacts: many.clinicalArtifacts(),
    },
    therapySessions: {
      messages: many.sessionMessages(),
      artifacts: many.clinicalArtifacts(),
    },
    sessionMessages: {
      session: one.therapySessions({
        from: sessionMessages.sessionId,
        to: therapySessions.id,
      }),
      patient: one.patients({
        from: sessionMessages.patientId,
        to: patients.id,
      }),
    },
    clinicalArtifacts: {
      session: one.therapySessions({
        from: clinicalArtifacts.sessionId,
        to: therapySessions.id,
      }),
      patient: one.patients({
        from: clinicalArtifacts.patientId,
        to: patients.id,
      }),
    },
  }),
)
