import type { IssueErrorReason, SaveAndIssueResult } from '@/actions/billing/issue'
import type { DraftErrorReason } from '@/actions/billing/drafts'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

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

/** Interface-language keys by reason (Phase E3). Hebrew stays `MESSAGES` itself. */
const KEYS: Record<string, MessageKey> = {
  payment_exceeds_total: 'billing.issueError.payment_exceeds_total',
  payment_incomplete: 'billing.issueError.payment_incomplete',
  issuer_identity_incomplete: 'billing.issueError.issuer_identity_incomplete',
  no_permission: 'billing.issueError.no_permission',
  lead_not_found: 'billing.issueError.lead_not_found',
  invoice_not_found: 'billing.issueError.invoice_not_found',
  not_draft: 'billing.issueError.not_draft',
  invoice_not_draft: 'billing.issueError.not_draft',
  empty_lines: 'billing.issueError.empty_lines',
  profile_archived: 'billing.issueError.profile_archived',
  empty_legal_name: 'billing.issueError.empty_legal_name',
  zero_total: 'billing.issueError.zero_total',
  line_not_found: 'billing.issueError.line_not_found',
  invalid_input: 'billing.issueError.invalid_input',
  failed: 'billing.issueError.failed',
}

/** `locale` (optional, default Hebrew): the editors pass the interface language; Hebrew is unchanged. */
export function issueErrorMessage(reason: string | undefined, locale: UiLocale = 'he'): string {
  if (locale !== 'he') return translatorFor(locale)((reason && KEYS[reason]) || KEYS.failed)
  if (!reason) return MESSAGES.failed
  return MESSAGES[reason] ?? MESSAGES.failed
}
