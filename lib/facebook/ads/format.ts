/**
 * Display formatting for Meta's numbers. A missing metric renders "—", never 0.
 * Money uses the AD ACCOUNT's currency as Meta reports it; no conversion.
 */

const DASH = '—'

export function formatAdsMoney(value: number | null, currency: string | null): string {
  if (value === null) return DASH
  if (!currency) return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(value)
  try {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(value)} ${currency}`
  }
}

export function formatAdsCount(value: number | null): string {
  return value === null ? DASH : new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(value)
}

/** Meta's `ctr` is already a percentage (1.5 means 1.5%). */
export function formatAdsPercent(value: number | null): string {
  return value === null ? DASH : `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(value)}%`
}

/** Frequency (impressions per person) — Meta's value, two decimals. */
export function formatAdsRatio(value: number | null): string {
  return value === null ? DASH : new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(value)
}

/** ROAS as a multiple, e.g. "3.2x". */
export function formatAdsRoas(value: number | null): string {
  return value === null ? DASH : `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(value)}x`
}

/** Relative change as a signed whole percentage; null means "no comparison". */
export function formatAdsChange(change: number | null): string | null {
  if (change === null) return null
  const pct = Math.round(change * 100)
  if (pct === 0) return '0%'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

/** "2026-08-16" → "16.08.2026" (a calendar day as Meta returned it; no timezone conversion). */
export function formatAdsDay(day: string, withYear = true): string {
  const [y, m, d] = day.split('-')
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}`
}

export function formatAdsPeriod(period: { since: string; until: string }): string {
  return period.since === period.until ? formatAdsDay(period.since) : `${formatAdsDay(period.since)}–${formatAdsDay(period.until)}`
}
