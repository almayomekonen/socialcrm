import { isPaymentMethod } from './methods'

export type PaymentDraft = {
  paymentMethod: string | null | undefined
  paymentAmount: number | null | undefined
  paymentDate: string | null | undefined
}

export type ValidatePaymentAtIssueInput = PaymentDraft & {
  invoiceTotal: number
}

export function validatePaymentAtIssue(input: ValidatePaymentAtIssueInput): void {
  const method = (input.paymentMethod ?? '').trim()
  if (!method) throw new Error('billing.validate.payment_method_missing')
  if (!isPaymentMethod(method)) throw new Error('billing.validate.payment_method_invalid')

  if (input.paymentAmount == null) throw new Error('billing.validate.payment_amount_missing')
  if (!Number.isFinite(input.paymentAmount) || input.paymentAmount <= 0) {
    throw new Error('billing.validate.payment_amount_invalid')
  }
  if (round2(input.paymentAmount) > round2(input.invoiceTotal)) {
    throw new Error('billing.validate.payment_amount_exceeds_total')
  }

  const date = (input.paymentDate ?? '').trim()
  if (!date) throw new Error('billing.validate.payment_date_missing')
}

export function fulfillStateForCombinedDoc(paymentAmount: number, invoiceTotal: number): 'paid' | 'partial' {
  return round2(paymentAmount) >= round2(invoiceTotal) ? 'paid' : 'partial'
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
