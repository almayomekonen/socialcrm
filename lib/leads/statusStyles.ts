/**
 * Lead status presentation — the single source, importable from BOTH sides.
 *
 * WHY THIS FILE EXISTS. These values used to live in
 * `components/clients/LeadStatusCell.tsx`, which is a `'use client'` module.
 * Importing a plain object across the RSC boundary does not give a Server
 * Component the object: it gives a client-reference proxy whose properties read
 * as `undefined`. A Server Component doing `STATUS_STYLES[status].bg` therefore
 * throws at render — which is exactly what the mobile lead card did.
 *
 * Framework-neutral by design: no `'use client'`, no React import, no JSX. Both
 * server and client code can import it, and `LeadStatusCell` re-exports it so
 * every existing import path keeps working unchanged.
 *
 * The Hebrew labels are the product vocabulary (`ux-guidelines.md` §6) and the
 * keys are the `LeadStatus` union — never re-declare either elsewhere. Labels
 * in other interface languages come from `leadStatusLabel(code, locale)`.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

export type LeadStatusStyle = {
  label: string
  bg: string
  text: string
  border: string
  dot: string
}

/**
 * Display label of each status CODE, in the interface language. The Hebrew
 * values are the catalog's `leads.status.*` — the exact words this table has
 * always used. Logic keys on the code; nothing ever compares a label.
 */
const STATUS_LABEL_KEY: Record<string, MessageKey> = {
  new: 'leads.status.new',
  contacted: 'leads.status.contacted',
  interested: 'leads.status.interested',
  closed: 'leads.status.closed',
  lost: 'leads.status.lost',
}

/** The lead form / duplicate banner wording for the same codes (`leads.statusForm.*`). */
const FORM_STATUS_LABEL_KEY: Record<string, MessageKey> = {
  new: 'leads.statusForm.new',
  contacted: 'leads.statusForm.contacted',
  interested: 'leads.statusForm.interested',
  closed: 'leads.statusForm.closed',
  lost: 'leads.statusForm.lost',
}

/** Table/tab/badge label for a status code; an unknown code returns `null`. */
export function leadStatusLabel(status: string | null | undefined, locale: UiLocale = 'he'): string | null {
  const key = status ? STATUS_LABEL_KEY[status] : undefined
  return key ? translatorFor(locale)(key) : null
}

/** Form / duplicate-banner label for a status code; an unknown code returns `null`. */
export function leadStatusFormLabel(status: string | null | undefined, locale: UiLocale = 'he'): string | null {
  const key = status ? FORM_STATUS_LABEL_KEY[status] : undefined
  return key ? translatorFor(locale)(key) : null
}

const he = (code: string) => leadStatusLabel(code) as string

export const STATUS_STYLES: Record<string, LeadStatusStyle> = {
  new:       { label: he('new'),        bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  contacted: { label: he('contacted'),  bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', dot: 'bg-yellow-500' },
  interested:{ label: he('interested'), bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500' },
  closed:    { label: he('closed'),     bg: 'bg-gray-100',  text: 'text-gray-600',   border: 'border-gray-200',   dot: 'bg-gray-400' },
  lost:      { label: he('lost'),       bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200',    dot: 'bg-red-500' },
}

export const STATUS_OPTIONS = Object.entries(STATUS_STYLES).map(([value, { label }]) => ({ value, label }))

/** `STATUS_OPTIONS` in the interface language (Hebrew by default — identical to `STATUS_OPTIONS`). */
export function statusOptions(locale: UiLocale = 'he'): { value: string; label: string }[] {
  return Object.keys(STATUS_STYLES).map((value) => ({ value, label: leadStatusLabel(value, locale) as string }))
}

/**
 * Style for a status, never undefined.
 *
 * Callers render `${style.bg}` directly, so a missing key must not produce
 * `undefined` — an unknown status (legacy row, future value) falls back to
 * `new` rather than crashing the screen it appears on.
 */
export function statusStyle(status: string | null | undefined): LeadStatusStyle {
  return STATUS_STYLES[status ?? 'new'] ?? STATUS_STYLES.new
}
