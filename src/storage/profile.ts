import type { PatientProfile } from '~/db/schema'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeProfile(
  filePath: string,
  telegramId: number,
  profile: PatientProfile,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const now = new Date().toISOString()

  const sections: string[] = [
    `# Patient Profile: ${profile.fullName || 'Unknown'}`,
    '',
    `**Telegram ID:** ${telegramId}`,
    `**Last Updated:** ${now}`,
  ]

  if (profile.preferredLanguage)
    sections.push(`**Preferred Language:** ${profile.preferredLanguage}`)

  if (profile.dateOfBirth)
    sections.push(`**Date of Birth:** ${profile.dateOfBirth}`)

  if (profile.gender)
    sections.push(`**Gender:** ${profile.gender}`)

  if (profile.occupation)
    sections.push(`**Occupation:** ${profile.occupation}`)

  if (profile.relationshipStatus)
    sections.push(`**Relationship Status:** ${profile.relationshipStatus}`)

  if (profile.attachmentStyle) {
    sections.push('', '## Attachment Style', profile.attachmentStyle)
  }

  if (profile.recurringThemes?.length) {
    sections.push('', '## Recurring Themes')

    for (const t of profile.recurringThemes) {
      sections.push(`- ${t.theme} (${t.frequency} mentions, trend: ${t.trend})`)
    }
  }

  if (profile.copingPatterns?.length) {
    sections.push('', '## Coping Patterns')

    for (const p of profile.copingPatterns) {
      sections.push(`- ${p}`)
    }
  }

  if (profile.therapyGoals?.length) {
    sections.push('', '## Goals')

    profile.therapyGoals.forEach((g, i) => {
      sections.push(`${i + 1}. ${g}`)
    })
  }

  if (profile.triggers?.length) {
    sections.push('', '## Triggers')

    for (const t of profile.triggers) {
      sections.push(`- ${t}`)
    }
  }

  if (profile.previousTherapyExperience) {
    sections.push(
      '',
      '## Previous Therapy Experience',
      profile.previousTherapyExperience,
    )
  }

  if (profile.progressNotes?.length) {
    sections.push('', '## Progress Notes')

    for (const n of profile.progressNotes) {
      sections.push(`- ${n.date}: ${n.note}`)
    }
  }

  sections.push('')

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
