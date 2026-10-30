import type { IssueBlocker } from '@/lib/billing/issueReadiness'
import type { MessageKey } from '@/lib/i18n/translate'

/** The issue button's disabled-reason title, per blocker (both editors). Hebrew: `billing.editor.blocker.*`. */
export const ISSUE_BLOCKER_KEYS: Record<IssueBlocker, MessageKey> = {
  no_permission: 'billing.editor.blocker.no_permission',
  no_lines: 'billing.editor.blocker.no_lines',
  zero_total: 'billing.editor.blocker.zero_total',
  payment_incomplete: 'billing.editor.blocker.payment_incomplete',
}
