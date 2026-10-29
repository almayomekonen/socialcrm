import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Labels for persisted conversation-intelligence CODES.
 * Used by the intelligence card, the conversation list rows and the toolbar —
 * display only, derived from stored analysis (no AI at render time).
 * Unknown values ('other', 'none', null) intentionally have no label and are hidden.
 *
 * The functions take the interface locale (default Hebrew). The `*_LABELS`
 * constants are the Hebrew copy, kept for their existing readers.
 */

const INTENT_KEY: Record<string, MessageKey> = {
  pricing: 'inbox.intel.intent.pricing',
  demo: 'inbox.intel.intent.demo',
  signup: 'inbox.intel.intent.signup',
  support: 'inbox.intel.intent.support',
  followup: 'inbox.intel.intent.followup',
  information: 'inbox.intel.intent.information',
}

const TEMPERATURE: Record<string, { key: MessageKey; cls: string }> = {
  hot: { key: 'inbox.intel.temperature.hot', cls: 'bg-red-100 text-red-700' },
  warm: { key: 'inbox.intel.temperature.warm', cls: 'bg-amber-100 text-amber-700' },
  cold: { key: 'inbox.intel.temperature.cold', cls: 'bg-blue-100 text-blue-700' },
}

const ACTION_KEY: Record<string, MessageKey> = {
  send_quote: 'inbox.intel.action.send_quote',
  schedule_demo: 'inbox.intel.action.schedule_demo',
  follow_up: 'inbox.intel.action.follow_up',
  answer_question: 'inbox.intel.action.answer_question',
  close_lead: 'inbox.intel.action.close_lead',
  escalate_support: 'inbox.intel.action.escalate_support',
}

const CONFIDENCE_KEY: Record<string, MessageKey> = {
  high: 'inbox.intel.confidence.high',
  medium: 'inbox.intel.confidence.medium',
  low: 'inbox.intel.confidence.low',
}

const label = (map: Record<string, MessageKey>, code: string | null | undefined, locale: UiLocale): string | null => {
  const key = code ? map[code] : undefined
  return key ? translatorFor(locale)(key) : null
}

export const intentLabel = (code: string | null | undefined, locale: UiLocale = 'he') => label(INTENT_KEY, code, locale)
export const actionLabel = (code: string | null | undefined, locale: UiLocale = 'he') => label(ACTION_KEY, code, locale)
export const confidenceLabel = (code: string | null | undefined, locale: UiLocale = 'he') => label(CONFIDENCE_KEY, code, locale)

export function temperatureBadge(code: string | null | undefined, locale: UiLocale = 'he'): { label: string; cls: string } | null {
  const entry = code ? TEMPERATURE[code] : undefined
  return entry ? { label: translatorFor(locale)(entry.key), cls: entry.cls } : null
}

const hebrew = (map: Record<string, MessageKey>) =>
  Object.fromEntries(Object.entries(map).map(([code, key]) => [code, translatorFor('he')(key)])) as Record<string, string>

export const INTENT_LABELS: Record<string, string> = hebrew(INTENT_KEY)

export const TEMPERATURE_BADGES: Record<string, { label: string; cls: string }> = Object.fromEntries(
  Object.keys(TEMPERATURE).map((code) => [code, temperatureBadge(code) as { label: string; cls: string }]),
)

export const ACTION_LABELS: Record<string, string> = hebrew(ACTION_KEY)

export const CONFIDENCE_LABELS: Record<string, string> = hebrew(CONFIDENCE_KEY)
