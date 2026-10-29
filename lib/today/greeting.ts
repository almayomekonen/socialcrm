// Today brief — time-of-day greeting. Pure and computed in the business timezone
// from an injected instant (no wall-clock read), so it is deterministic and safe to
// compute server-side. Relocated here from the dashboard so it has one home.

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'
import { BUSINESS_TZ } from './constants'

export type GreetingKey = 'morning' | 'afternoon' | 'evening'

/** morning (05–11) · afternoon (12–16) · evening (otherwise), in the business timezone. */
export function greetingKey(nowMs: number, tz: string = BUSINESS_TZ): GreetingKey {
  const hourStr = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date(nowMs))
  const hour = Number.parseInt(hourStr, 10)
  if (hour >= 5 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 16) return 'afternoon'
  return 'evening'
}

/** 'בוקר טוב' · 'צהריים טובים' · 'ערב טוב' in Hebrew (the default); the same buckets in any locale. */
const GREETING_KEY: Record<GreetingKey, MessageKey> = {
  morning: 'today.greeting.morning',
  afternoon: 'today.greeting.afternoon',
  evening: 'today.greeting.evening',
}

export function greetingFor(nowMs: number, tz: string = BUSINESS_TZ, locale: UiLocale = 'he'): string {
  return translatorFor(locale)(GREETING_KEY[greetingKey(nowMs, tz)])
}
