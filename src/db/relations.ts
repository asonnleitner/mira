import { defineRelations } from 'drizzle-orm'
import { checkInPreferences, clinicalArtifacts, patients, sessionMessages, therapySessions } from '~/db/schema'

export const relations = defineRelations(
  { patients, therapySessions, sessionMessages, clinicalArtifacts, checkInPreferences },
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
    checkInPreferences: {},
  }),
)
