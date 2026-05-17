import type { IssueErrorReason, SaveAndIssueResult } from '@/actions/billing/issue'
import type { DraftErrorReason } from '@/actions/billing/drafts'

export type IssueOrSaveReason =
  | IssueErrorReason
  | DraftErrorReason
  | NonNullable<Exclude<SaveAndIssueResult, { success: true }>['reason']>

const MESSAGES: Record<string, string> = {
  payment_exceeds_total: 'הסכום שהתקבל לא יכול להיות גבוה מסכום המסמך',
  payment_incomplete: 'יש להשלים את פרטי התשלום',
  issuer_identity_incomplete: 'יש להשלים את פרטי העסק',
  no_permission: 'אין הרשאה להנפיק',
  lead_not_found: 'הליד לא נמצא',
  invoice_not_found: 'החשבונית לא נמצאה',
  not_draft: 'החשבונית כבר הונפקה',
  invoice_not_draft: 'החשבונית כבר הונפקה',
  empty_lines: 'יש להוסיף לפחות פריט אחד',
  profile_archived: 'פרופיל החיוב לא פעיל',
  empty_legal_name: 'יש להזין שם לחיוב',
  zero_total: 'סכום המסמך חייב להיות גדול מאפס',
  line_not_found: 'אחד הפריטים לא נמצא',
  invalid_input: 'נתונים לא תקינים',
  failed: 'הנפקת החשבונית נכשלה',
}

export function issueErrorMessage(reason: string | undefined): string {
  if (!reason) return MESSAGES.failed
  return MESSAGES[reason] ?? MESSAGES.failed
}
