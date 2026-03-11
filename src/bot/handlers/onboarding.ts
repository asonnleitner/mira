import type { BotContext } from '~/bot/context'
import type { PatientProfile } from '~/db/schema'
import { join } from 'node:path'
import { config } from '~/config'
import { completeOnboarding, createPatient, findPatientByTelegramId } from '~/db/queries/patients'
import { writeProfile } from '~/storage/profile'

// In-memory store for tracking onboarding state per user
const onboardingState = new Map<
  number,
  { step: string, profile: Partial<PatientProfile> }
>()

const STEPS = [
  'name',
  'age',
  'gender',
  'occupation',
  'relationship_status',
  'previous_therapy',
  'goals',
  'language',
] as const

type Step = (typeof STEPS)[number]

const PROMPTS: Record<Step, string> = {
  name: 'What should I call you?',
  age: 'How old are you?',
  gender: 'How do you identify? (or type "skip")',
  occupation: 'What do you do for work? (or type "skip")',
  relationship_status: 'What\'s your current relationship status?',
  previous_therapy:
    'Have you been to therapy before? If so, what was your experience like?',
  goals: 'What are you hoping to get out of our sessions together?',
  language:
    'Would you prefer to communicate in English or Czech?\nPreferujete komunikaci v anglictine nebo cestine?',
}

export async function startOnboarding(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id

  // Ensure patient record exists
  let patient = await findPatientByTelegramId(telegramId)
  if (!patient) {
    patient = await createPatient({
      telegramId,
      firstName: ctx.from!.first_name,
      username: ctx.from!.username,
    })
  }

  ctx.session.patientId = patient.id

  onboardingState.set(telegramId, { step: 'name', profile: {} })

  await ctx.reply(
    `Welcome! I'm your AI therapy companion. Before we begin, I'd like to learn a bit about you. Everything you share stays private and helps me provide better support.\n\n${
      PROMPTS.name}`,
  )
}

export function isOnboarding(telegramId: number): boolean {
  return onboardingState.has(telegramId)
}

export async function handleOnboardingMessage(
  ctx: BotContext,
): Promise<void> {
  const telegramId = ctx.from!.id
  const state = onboardingState.get(telegramId)
  if (!state)
    return

  const text = ctx.message?.text?.trim()
  if (!text)
    return

  const currentStep = state.step as Step
  const profile = state.profile
  const skip = text.toLowerCase() === 'skip'

  // Process current step
  switch (currentStep) {
    case 'name':
      profile.fullName = text
      break
    case 'age': {
      const age = Number.parseInt(text, 10)
      if (Number.isNaN(age) || age < 1 || age > 120) {
        await ctx.reply('Please enter a valid age (number).')
        return
      }
      profile.age = age
      break
    }
    case 'gender':
      if (!skip)
        profile.gender = text
      break
    case 'occupation':
      if (!skip)
        profile.occupation = text
      break
    case 'relationship_status':
      profile.relationshipStatus = text
      break
    case 'previous_therapy':
      profile.previousTherapyExperience = text
      break
    case 'goals':
      profile.therapyGoals = text.split(/[,;\n]/).map(g => g.trim()).filter(Boolean)
      break
    case 'language': {
      const lower = text.toLowerCase()
      if (
        lower.includes('czech')
        || lower.includes('ces')
        || lower.includes('cs')
      ) {
        profile.preferredLanguage = 'cs'
      }
      else {
        profile.preferredLanguage = 'en'
      }
      break
    }
  }

  // Move to next step
  const currentIdx = STEPS.indexOf(currentStep)
  const nextIdx = currentIdx + 1

  if (nextIdx < STEPS.length) {
    const nextStep = STEPS[nextIdx]
    state.step = nextStep
    await ctx.reply(PROMPTS[nextStep])
  }
  else {
    // Onboarding complete
    onboardingState.delete(telegramId)

    const fullProfile = profile as PatientProfile
    const patient = await completeOnboarding(telegramId, fullProfile)

    if (patient) {
      ctx.session.patientId = patient.id
    }

    // Write PROFILE.md
    const profilePath = join(
      config.DATA_DIR,
      'patients',
      String(telegramId),
      'PROFILE.md',
    )
    await writeProfile(profilePath, telegramId, fullProfile)

    const lang = fullProfile.preferredLanguage
    const msg
      = lang === 'cs'
        ? `Dekuji, ${fullProfile.fullName}! Vas profil je nastaven. Muzete zacit psat kdykoliv a ja tu pro vas budu. Nase sezeni zacina nyni.`
        : `Thank you, ${fullProfile.fullName}! Your profile is set up. You can start writing anytime and I'll be here for you. Our session starts now.`

    await ctx.reply(msg)
  }
}
