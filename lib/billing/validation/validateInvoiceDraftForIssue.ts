/**
 * Pure validation for the draft → issued transition. Throws on the first
 * violation with a namespaced error reason. No I/O, no DB access — the
 * caller loads the relevant rows inside the issuance transaction and
 * passes the minimal projection of fields this validator needs.
 *
 * Reasons:
 *   - billing.validate.not_draft           docState !== 'draft'
 *   - billing.validate.empty_lines         no line items
 *   - billing.validate.profile_archived    billing profile state !== 'active'
 *   - billing.validate.empty_legal_name    profile legal name blank
 */

export type ValidateDraftForIssueInput = {
  docState: string
  lineCount: number
  profileLegalName: string
  profileState: string
}

export function validateInvoiceDraftForIssue(input: ValidateDraftForIssueInput): void {
  if (input.docState !== 'draft') {
    throw new Error('billing.validate.not_draft')
  }
  if (input.lineCount <= 0) {
    throw new Error('billing.validate.empty_lines')
  }
  if (input.profileState !== 'active') {
    throw new Error('billing.validate.profile_archived')
  }
  if (!input.profileLegalName.trim()) {
    throw new Error('billing.validate.empty_legal_name')
  }
}
