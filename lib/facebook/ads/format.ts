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
