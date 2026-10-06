/**
 * Reporting date range — pure, validated, safe to use on server and client.
 *
 * Presets map to Meta's own `date_preset` values, which Meta evaluates in the
 * AD ACCOUNT's timezone — the same days Ads Manager shows. A custom range goes
 * out as `time_range` ({since, until}, YYYY-MM-DD, inclusive), limited to Meta's
 * 37-month lookback (https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/).
 */

export const ADS_RANGE_PRESETS = ['today', 'last_7d', 'last_30d', 'this_month', 'last_month'] as const
export type AdsRangePreset = (typeof ADS_RANGE_PRESETS)[number]

export const ADS_RANGE_LABEL: Record<AdsRangePreset | 'custom', string> = {
  today: 'היום',
  last_7d: '7 ימים אחרונים',
  last_30d: '30 ימים אחרונים',
  this_month: 'החודש',
  last_month: 'החודש הקודם',
  custom: 'טווח תאריכים',
}

export type AdsRange = { kind: 'preset'; preset: AdsRangePreset } | { kind: 'custom'; since: string; until: string }

export const DEFAULT_ADS_RANGE: AdsRange = { kind: 'preset', preset: 'last_30d' }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_LOOKBACK_MONTHS = 37

function isRealDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * Querystring → range. `today` is `YYYY-MM-DD`, injected by the server.
 * Anything invalid falls back to the default and says so, never silently
 * querying something the user did not ask for.
 */
export function parseAdsRange(
  input: { range?: string; since?: string; until?: string },
  today: string,
): { range: AdsRange; invalid: boolean } {
  if (input.range === 'custom') {
    const { since = '', until = '' } = input
    if (!isRealDay(since) || !isRealDay(until) || since > until) return { range: DEFAULT_ADS_RANGE, invalid: true }
    const oldest = new Date(`${today}T00:00:00Z`)
    oldest.setUTCMonth(oldest.getUTCMonth() - MAX_LOOKBACK_MONTHS)
    if (since < oldest.toISOString().slice(0, 10) || since > today) return { range: DEFAULT_ADS_RANGE, invalid: true }
    return { range: { kind: 'custom', since, until: until > today ? today : until }, invalid: false }
  }
  if (input.range && (ADS_RANGE_PRESETS as readonly string[]).includes(input.range)) {
    return { range: { kind: 'preset', preset: input.range as AdsRangePreset }, invalid: false }
  }
  return { range: DEFAULT_ADS_RANGE, invalid: Boolean(input.range) }
}

/** The Insights query parameters for a range. */
export function insightsRangeParams(range: AdsRange): Record<string, string> {
  return range.kind === 'preset'
    ? { date_preset: range.preset }
    : { time_range: JSON.stringify({ since: range.since, until: range.until }) }
}

export function adsRangeLabel(range: AdsRange): string {
  return range.kind === 'preset' ? ADS_RANGE_LABEL[range.preset] : `${range.since} – ${range.until}`
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * A range as explicit calendar days, following Meta's own preset definitions
 * (`last_7d` / `last_30d` are the N full days BEFORE today; `this_month` runs
 * to today). Used only where there is no Meta response to take the period from
 * — the SocialCRM-only view — and the resolved dates are always printed there.
 */
export function rangeDays(range: AdsRange, today: string): { since: string; until: string } {
  if (range.kind === 'custom') return { since: range.since, until: range.until }
  switch (range.preset) {
    case 'today':
      return { since: today, until: today }
    case 'last_7d':
      return { since: addDays(today, -7), until: addDays(today, -1) }
    case 'last_30d':
      return { since: addDays(today, -30), until: addDays(today, -1) }
    case 'this_month':
      return { since: `${today.slice(0, 8)}01`, until: today }
    case 'last_month': {
      const firstThis = `${today.slice(0, 8)}01`
      const lastPrev = addDays(firstThis, -1)
      return { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev }
    }
  }
}

/**
 * Stable cache key for a range. A preset's days move every midnight, so the key
 * carries the day it was asked on — "last_7d" today is a different question
 * from "last_7d" yesterday. Starts with the preset, so "today" keys match a
 * shorter freshness window.
 */
export function rangeKey(range: AdsRange, today: string): string {
  return range.kind === 'preset' ? `${range.preset}@${today}` : `custom:${range.since}:${range.until}`
}
