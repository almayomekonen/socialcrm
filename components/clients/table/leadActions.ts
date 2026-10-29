/**
 * Lead row / group actions, identified by STABLE CODES.
 *
 * The menu used to be an object keyed by its Hebrew labels, and the click
 * handler `switch`ed on that text ('עריכה', 'העברה לבעל ליד אחר'). Translating a
 * label would have silently changed what the button does. Behaviour now reads
 * the code only; the label is looked up separately, for display.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

export type LeadActionCode = 'edit' | 'deal' | 'transfer'

/** Menu order. */
export const LEAD_ACTION_CODES: readonly LeadActionCode[] = ['edit', 'deal', 'transfer']

const ACTION_KEY = {
  edit: 'leads.action.edit',
  transfer: 'leads.action.transfer',
  deal: 'leads.action.deal',
  dealAnother: 'leads.action.dealAnother',
  dealLost: 'leads.action.dealLost',
} as const satisfies Record<string, MessageKey>

/** The deal action is worded by where the lead stands (by status CODE). */
export function getDealActionLabel(status?: string, locale: UiLocale = 'he') {
  const t = translatorFor(locale)
  if (status === 'closed') return t(ACTION_KEY.dealAnother)
  if (status === 'lost') return t(ACTION_KEY.dealLost)
  return t(ACTION_KEY.deal)
}

export function leadActionLabel(code: LeadActionCode, status?: string, locale: UiLocale = 'he'): string {
  switch (code) {
    case 'edit':
      return translatorFor(locale)(ACTION_KEY.edit)
    case 'deal':
      return getDealActionLabel(status, locale)
    case 'transfer':
      return translatorFor(locale)(ACTION_KEY.transfer)
  }
}

export type LeadActionItem = { code: LeadActionCode; label: string }

/** The row menu's entries for a lead. Transfer only exists with several users. */
export function leadRowActions(status: string | undefined, hasMultipleUsers: boolean, locale: UiLocale = 'he'): LeadActionItem[] {
  return LEAD_ACTION_CODES.filter((code) => hasMultipleUsers || code !== 'transfer').map((code) => ({
    code,
    label: leadActionLabel(code, status, locale),
  }))
}

/** The toolbar's group-action entries (no single lead, so no status). */
export function leadGroupActions(locale: UiLocale = 'he'): LeadActionItem[] {
  return LEAD_ACTION_CODES.map((code) => ({ code, label: leadActionLabel(code, undefined, locale) }))
}

/**
 * The group `<select>` still submits the option's display text (changing the
 * option `value` attribute would change the recorded Hebrew markup). It is
 * resolved back to a code HERE, against the same list that rendered it, and
 * nothing downstream ever compares label text.
 */
/** A submitted `<option>` value back to its action code; anything else is not an action. */
export function asLeadActionCode(optionValue: string): LeadActionCode | null {
  return (LEAD_ACTION_CODES as readonly string[]).includes(optionValue) ? (optionValue as LeadActionCode) : null
}
