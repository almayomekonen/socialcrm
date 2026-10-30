import type { PaymentMethod } from '@/lib/billing/payment/methods'

/**
 * Whether a draft can be issued right now, and if not, the FIRST blocking
 * reason — shared by the new-invoice editor and the draft editor, which used to
 * compute the same chain inline. Pure; the editors word the reason.
 *
 * `paymentAmount` is the EFFECTIVE amount (the typed one, else the total).
 */
export type IssueBlocker = 'no_permission' | 'no_lines' | 'zero_total' | 'payment_incomplete'

export function issueReadiness(input: {
  canIssue: boolean
  hasLines: boolean
  total: number
  isCombinedDoc: boolean
  paymentMethod: PaymentMethod | ''
  paymentAmount: number | null
  paymentDate: string
}): { paymentComplete: boolean; canIssueNow: boolean; blocker: IssueBlocker | null } {
  const { canIssue, hasLines, total, isCombinedDoc, paymentMethod, paymentAmount, paymentDate } = input
  const paymentComplete =
    !isCombinedDoc ||
    (paymentMethod !== '' &&
      paymentAmount != null &&
      paymentAmount > 0 &&
      paymentAmount <= total + 0.0001 &&
      paymentDate.length > 0)
  const canIssueNow = canIssue && hasLines && total > 0 && paymentComplete
  const blocker: IssueBlocker | null = !canIssue
    ? 'no_permission'
    : !hasLines
      ? 'no_lines'
      : total <= 0
        ? 'zero_total'
        : !paymentComplete
          ? 'payment_incomplete'
          : null
  return { paymentComplete, canIssueNow, blocker }
}
