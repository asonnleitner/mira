import { defineRelations } from 'drizzle-orm'
import { clinicalArtifacts, artifactTypeEnum } from './artifacts.js'
import { sessionMessages } from './messages.js'
import { patients, type PatientProfile } from './patients.js'
import { therapySessions, sessionTypeEnum, sessionStatusEnum } from './sessions.js'

export {
  patients,
  type PatientProfile,
  therapySessions,
  sessionTypeEnum,
  sessionStatusEnum,
  sessionMessages,
  clinicalArtifacts,
  artifactTypeEnum,
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
