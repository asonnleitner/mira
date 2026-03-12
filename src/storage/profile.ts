import type { PatientProfile } from '~/db/schema'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeProfile(
  filePath: string,
  telegramId: number,
  profile: PatientProfile,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const now = new Date().toISOString().split('T')[0]

  const sections: string[] = [
    `# Patient Profile`,
    '',
    `**Name:** ${profile.fullName || 'Unknown'}`,
  ]

  if (profile.dateOfBirth)
    sections.push(`**Date of Birth:** ${profile.dateOfBirth}`)

  if (profile.gender)
    sections.push(`**Gender:** ${profile.gender}`)

  if (profile.occupation)
    sections.push(`**Occupation:** ${profile.occupation}`)

  if (profile.relationshipStatus)
    sections.push(`**Relationship Status:** ${profile.relationshipStatus}`)

  if (profile.preferredLanguage)
    sections.push(`**Preferred Language:** ${profile.preferredLanguage}`)

  sections.push(`**Profile Created:** ${now}`)

  if (profile.therapyGoals?.length) {
    sections.push('', '## Therapy Goals')
    for (const g of profile.therapyGoals) {
      sections.push(`- ${g}`)
    }
  }

  if (profile.previousTherapyExperience) {
    sections.push(
      '',
      '## Previous Therapy Experience',
      profile.previousTherapyExperience,
    )
  }

  sections.push(
    '',
    '## Clinical Observations',
    '*To be updated as sessions progress.*',
    '',
    '## Session Notes',
    '*To be updated after each significant exchange.*',
    '',
  )

  await Bun.write(filePath, sections.join('\n'))
}

export async function readProfile(filePath: string): Promise<string> {
  const file = Bun.file(filePath)

  if (await file.exists())
    return file.text()

  return ''
}

export async function writeRelationshipProfile(
  filePath: string,
  data: {
    chatId: number
    partner1: string
    partner2: string
    duration?: string
    reason?: string
    sharedGoals?: string[]
  },
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const sections: string[] = [
    `# Relationship Profile`,
    '',
    `**Chat ID:** ${data.chatId}`,
    `**Partners:** ${data.partner1} & ${data.partner2}`,
    `**Last Updated:** ${new Date().toISOString()}`,
  ]

  if (data.duration)
    sections.push(`**Together:** ${data.duration}`)

  if (data.reason)
    sections.push('', '## Reason for Therapy', data.reason)

  if (data.sharedGoals?.length) {
    sections.push('', '## Shared Goals')
    data.sharedGoals.forEach((g, i) => sections.push(`${i + 1}. ${g}`))
  }

  sections.push(
    '',
    '## Dynamics',
    '*(To be updated as therapy progresses)*',
    '',
    '## Conflict Areas',
    '*(To be updated as therapy progresses)*',
    '',
  )

  await Bun.write(filePath, sections.join('\n'))
}
