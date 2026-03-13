import { defineRelations } from 'drizzle-orm'
import {
  chatMembers,
  chats,
  checkInPreferences,
  clinicalArtifacts,
  onboardings,
  patients,
  sessionMessages,
  therapySessions,
} from '~/db/schema'

export const relations = defineRelations(
  { patients, chats, chatMembers, therapySessions, sessionMessages, clinicalArtifacts, checkInPreferences, onboardings },
  ({ one, many, patients, chats, chatMembers, therapySessions, sessionMessages, clinicalArtifacts, checkInPreferences, onboardings }) => ({
    patients: {
      chatMemberships: many.chatMembers(),
      messages: many.sessionMessages(),
      artifacts: many.clinicalArtifacts(),
      onboardings: many.onboardings(),
    },
    chats: {
      members: many.chatMembers(),
      sessions: many.therapySessions(),
      checkInPreference: one.checkInPreferences({
        from: chats.id,
        to: checkInPreferences.chatId,
      }),
      onboardings: many.onboardings(),
    },
    chatMembers: {
      chat: one.chats({
        from: chatMembers.chatId,
        to: chats.id,
      }),
      patient: one.patients({
        from: chatMembers.patientId,
        to: patients.id,
      }),
    },
    therapySessions: {
      chat: one.chats({
        from: therapySessions.chatId,
        to: chats.id,
      }),
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
    checkInPreferences: {
      chat: one.chats({
        from: checkInPreferences.chatId,
        to: chats.id,
      }),
    },
    onboardings: {
      chat: one.chats({
        from: onboardings.chatId,
        to: chats.id,
      }),
      patient: one.patients({
        from: onboardings.patientId,
        to: patients.id,
      }),
    },
  }),
)
