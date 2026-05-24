export const INTENTS = [
  'social.gratitude',
  'social.greeting',
  'social.positive',
  'social.farewell',
  'task',
  'crm',
  'search',
  'unknown',
] as const

export type Intent = (typeof INTENTS)[number]

export type SocialIntent = Extract<Intent, `social.${string}`>

export const SOCIAL_INTENTS: readonly SocialIntent[] = [
  'social.gratitude',
  'social.greeting',
  'social.positive',
  'social.farewell',
]

export function isSocialIntent(intent: Intent): intent is SocialIntent {
  return intent.startsWith('social.')
}
