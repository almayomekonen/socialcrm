import type { UiLocale } from './config'
import { intlLocale } from './translate'

/**
 * Locale-aware formatting for the interface language. Phase A provides the
 * functions; screens adopt them as they are translated (Phase B onwards).
 *
 * Two inputs are REQUIRED on purpose, never defaulted:
 *
 * - `timeZone` on every date/time function. Business-day semantics use
 *   `BUSINESS_TZ` (lib/today/constants.ts); a meeting uses its own
 *   `meetings.timezone`. A formatter that silently used the server's zone
 *   (UTC on Vercel) is the bug behind the React #418 dashboard crash
 *   (architecture-rules §11).
 * - `currency` on money. Changing the interface language never changes or
 *   converts an amount's currency, so the caller must supply the currency of
 *   the RECORD. Where no record carries one (deals — `sales` has no currency
 *   column) there is nothing correct to pass; see claude/i18n.md
 *   "Formatting sources" before formatting such amounts.
 *
 * Arabic uses Latin digits (`intlLocale`), matching the CRM's stored data.
 * Pure functions: same inputs, same output on server and client.
 */

type DateInput = Date | string | number

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

export type DateStyle = 'short' | 'medium' | 'long'

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'numeric', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
}

export function formatDate(locale: UiLocale, value: DateInput, timeZone: string, style: DateStyle = 'medium'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...DATE_STYLES[style], timeZone }).format(toDate(value))
}

export function formatTime(locale: UiLocale, value: DateInput, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: '2-digit', minute: '2-digit', timeZone }).format(toDate(value))
}

export function formatDateTime(locale: UiLocale, value: DateInput, timeZone: string, style: DateStyle = 'medium'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...DATE_STYLES[style],
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(toDate(value))
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/**
 * "yesterday", "in 3 hours". `now` is a parameter, never `Date.now()`, so a
 * server-computed value cannot drift from what the client renders.
 */
export function formatRelative(locale: UiLocale, value: DateInput, now: DateInput): string {
  const seconds = Math.round((toDate(value).getTime() - toDate(now).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit)
  }
  return rtf.format(0, 'minute')
}

export function formatNumber(locale: UiLocale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value)
}

/** `ratio` is a fraction: 0.25 → "25%". */
export function formatPercent(locale: UiLocale, ratio: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'percent', maximumFractionDigits }).format(ratio)
}

/** `currency` is the ISO 4217 code stored on the record (e.g. bill_invoices.currency). */
export function formatMoney(
  locale: UiLocale,
  amount: number,
  currency: string,
  options?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(amount)
}
