/**
 * Typed SocialCRM product knowledge for the IRE sales agent.
 * Only capabilities verified in code belong in the catalog.
 */

export const CAPABILITY_CATEGORIES = [
  'leads',
  'inbox',
  'integrations',
  'follow_up',
  'notifications',
  'team',
  'calendar',
  'quotes',
  'billing',
  'automations',
  'ai',
  'auto_response',
] as const
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]

export const CAPABILITY_AVAILABILITY = ['all', 'pro', 'allowlisted', 'requires_setup'] as const
export type CapabilityAvailability = (typeof CAPABILITY_AVAILABILITY)[number]

export type ProductCapability = {
  id: string
  name: string
  category: CapabilityCategory
  /** Customer-language keywords that make this capability relevant. */
  whenRelevant: readonly string[]
  safeExplanationHe: string
  safeExplanationEn: string
  limitations: readonly string[]
  availability: CapabilityAvailability
  mayMentionProactively: boolean
  requiresHuman: boolean
  closestAlternatives: readonly string[]
}
