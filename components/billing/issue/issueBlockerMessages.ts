import type { IssueBlocker } from '@/lib/billing/issueReadiness'

/** The issue button's disabled-reason title, per blocker (both editors). */
export const ISSUE_BLOCKER_MESSAGES: Record<IssueBlocker, string> = {
  no_permission: 'אין הרשאה להנפיק',
  no_lines: 'יש להוסיף לפחות פריט אחד',
  zero_total: 'סכום החשבונית חייב להיות גדול מאפס',
  payment_incomplete: 'יש למלא את פרטי התשלום שהתקבל',
}
