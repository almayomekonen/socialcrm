// Today brief — time-of-day greeting. Pure and computed in the business timezone
// from an injected instant (no wall-clock read), so it is deterministic and safe to
// compute server-side. Relocated here from the dashboard so it has one home.

import { BUSINESS_TZ } from './constants'

/** 'בוקר טוב' (05–11) · 'צהריים טובים' (12–16) · 'ערב טוב' (otherwise), in BUSINESS_TZ. */
export function greetingFor(nowMs: number, tz: string = BUSINESS_TZ): string {
  const hourStr = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date(nowMs))
  const hour = Number.parseInt(hourStr, 10)
  if (hour >= 5 && hour <= 11) return 'בוקר טוב'
  if (hour >= 12 && hour <= 16) return 'צהריים טובים'
  return 'ערב טוב'
}
