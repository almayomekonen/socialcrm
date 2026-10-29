/**
 * Lead row / group actions, identified by STABLE CODES.
 *
 * The menu used to be an object keyed by its Hebrew labels, and the click
 * handler `switch`ed on that text ('עריכה', 'העברה לבעל ליד אחר'). Translating a
 * label would have silently changed what the button does. Behaviour now reads
 * the code only; the label is looked up separately, for display.
 */

export type LeadActionCode = 'edit' | 'deal' | 'transfer'

/** Menu order. */
export const LEAD_ACTION_CODES: readonly LeadActionCode[] = ['edit', 'deal', 'transfer']

/** The deal action is worded by where the lead stands. */
export function getDealActionLabel(status?: string) {
  if (status === 'closed') return 'הוסף עסקה נוספת'
  if (status === 'lost') return 'הוסף עסקה (ליד אבוד)'
  return 'סגור עסקה'
}

export function leadActionLabel(code: LeadActionCode, status?: string): string {
  switch (code) {
    case 'edit':
      return 'עריכה'
    case 'deal':
      return getDealActionLabel(status)
    case 'transfer':
      return 'העברה לבעל ליד אחר'
  }
}

export type LeadActionItem = { code: LeadActionCode; label: string }

/** The row menu's entries for a lead. Transfer only exists with several users. */
export function leadRowActions(status: string | undefined, hasMultipleUsers: boolean): LeadActionItem[] {
  return LEAD_ACTION_CODES.filter((code) => hasMultipleUsers || code !== 'transfer').map((code) => ({
    code,
    label: leadActionLabel(code, status),
  }))
}

/** The toolbar's group-action entries (no single lead, so no status). */
export function leadGroupActions(): LeadActionItem[] {
  return LEAD_ACTION_CODES.map((code) => ({ code, label: leadActionLabel(code) }))
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
