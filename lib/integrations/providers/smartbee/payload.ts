import type { IssuerBusinessType } from '@/lib/integrations/core/types'
import type { SmartbeeDocType, SmartbeeDocumentBody, SmartbeeReceiptDetails, SmartbeeVatOption } from './types'

/**
 * From a document the owner approved to SmartBee's `DocumentRequest`. Pure: no
 * I/O, no clock. Everything SmartBee would reject later is refused here first,
 * per the guide's rules:
 *
 *   · An עוסק פטור issues `Receipt` only; `Invoice` / `InvoiceReceipt` need an
 *     עוסק מורשה or a company.
 *   · `Invoice` has line items and no payment; `Receipt` has a payment and no
 *     line items; `InvoiceReceipt` has both and they must be equal.
 *   · SmartBee applies its own VAT rate. We never compute VAT, so an
 *     `InvoiceReceipt` is accepted only for a price that INCLUDES VAT: then the
 *     payment equals the stated amount exactly. A price before VAT would need a
 *     total we would have to calculate, so it is refused instead.
 *   · One line, quantity 1: the amount the owner stated.
 *
 * ALWAYS `sendOriginalToCustomer: false` (SmartBee's default is to email the
 * customer), never a draft, never a draft on failure. No customer email, phone
 * or `providerCustomerId` is sent: the last one would freeze SmartBee's copy of
 * the customer permanently.
 */

export type PaymentMethod = 'cash' | 'credit_card' | 'bank_transfer' | 'check' | 'other'

/** The payment exactly as the OWNER confirmed it on the card. */
export type ConfirmedPayment = {
  method: PaymentMethod
  amount: number
  /** YYYY-MM-DD, or null for the document's date. */
  paidOn: string | null
  installments: number | null
  checkNumber: string | null
  reference: string | null
  /** For `other`: the owner's word for it ("ביט", "פייבוקס"). */
  otherLabel: string | null
}

export type DocumentDraft = {
  docType: SmartbeeDocType
  description: string
  amount: number
  vatOption: SmartbeeVatOption | null
  payment: ConfirmedPayment | null
  customer: { name: string; idNum: string | null }
}

export type PayloadFailure =
  | 'doc_type_not_allowed'
  | 'customer_name_invalid'
  | 'description_invalid'
  | 'amount_invalid'
  | 'vat_required'
  | 'invoice_receipt_needs_incl_vat'
  | 'payment_required'
  | 'payment_not_allowed'
  | 'payment_amount_mismatch'
  | 'payment_method_invalid'
  | 'check_number_required'
  | 'other_label_required'
  | 'installments_invalid'
  | 'paid_on_invalid'

const MAX_AMOUNT = 9_999_999.9
const ALL_TYPES: readonly SmartbeeDocType[] = ['Invoice', 'Receipt', 'InvoiceReceipt']

export function allowedDocTypes(businessType: IssuerBusinessType): readonly SmartbeeDocType[] {
  return businessType === 'exempt' ? ['Receipt'] : ALL_TYPES
}

const validAmount = (n: number) => Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT && Math.abs(Math.round(n * 100) - n * 100) < 1e-6
const sameAmount = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100)
const lengthIn = (s: string | null | undefined, min: number, max: number) => typeof s === 'string' && s.trim().length >= min && s.trim().length <= max

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function paymentProblem(p: ConfirmedPayment, amount: number): PayloadFailure | null {
  if (!['cash', 'credit_card', 'bank_transfer', 'check', 'other'].includes(p.method)) return 'payment_method_invalid'
  if (!validAmount(p.amount) || !sameAmount(p.amount, amount)) return 'payment_amount_mismatch'
  if (p.paidOn != null && !validDate(p.paidOn)) return 'paid_on_invalid'
  if (p.method === 'credit_card' && p.installments != null && !(Number.isInteger(p.installments) && p.installments >= 1 && p.installments <= 99)) return 'installments_invalid'
  if (p.method === 'check' && !lengthIn(p.checkNumber, 1, 25)) return 'check_number_required'
  if (p.method === 'other' && !lengthIn(p.otherLabel, 1, 20)) return 'other_label_required'
  return null
}

export function validateDocumentDraft(d: DocumentDraft, businessType: IssuerBusinessType): { ok: true } | { ok: false; reason: PayloadFailure } {
  const fail = (reason: PayloadFailure) => ({ ok: false as const, reason })
  if (!allowedDocTypes(businessType).includes(d.docType)) return fail('doc_type_not_allowed')
  if (!lengthIn(d.customer.name, 2, 100)) return fail('customer_name_invalid')
  if (!lengthIn(d.description, 1, 500)) return fail('description_invalid')
  if (!validAmount(d.amount)) return fail('amount_invalid')

  if (d.docType === 'Invoice') {
    if (d.vatOption !== 'Include' && d.vatOption !== 'NotInclude') return fail('vat_required')
    if (d.payment) return fail('payment_not_allowed')
    return { ok: true }
  }
  if (!d.payment) return fail('payment_required')
  if (d.docType === 'InvoiceReceipt' && d.vatOption !== 'Include') return fail('invoice_receipt_needs_incl_vat')
  const problem = paymentProblem(d.payment, d.amount)
  return problem ? fail(problem) : { ok: true }
}

/** Calendar date at noon UTC: the same day in Israel all year (SmartBee keeps the date part only). */
const isoDate = (s: string | null) => (s ? `${s}T12:00:00Z` : undefined)
const trimmed = (s: string | null | undefined) => (typeof s === 'string' && s.trim() ? s.trim() : undefined)

function receiptDetails(p: ConfirmedPayment): SmartbeeReceiptDetails {
  const base = { sum: p.amount, ...(p.paidOn ? { date: isoDate(p.paidOn) } : {}) }
  switch (p.method) {
    case 'cash':
      return { cashItems: [base] }
    case 'credit_card': {
      const installments = p.installments ?? 1
      return {
        creditCardItems: [{ ...base, creditCardType: 'Other', creditDealType: installments > 1 ? 'Installments' : 'Regular', installmentsNumber: installments }],
      }
    }
    case 'check':
      return { checkItems: [{ ...base, checkId: p.checkNumber!.trim() }] }
    case 'bank_transfer':
      return { wireTransferItems: [{ ...base, ...(trimmed(p.reference) ? { referenceNum: trimmed(p.reference) } : {}) }] }
    case 'other':
      return { otherItems: [{ ...base, description: p.otherLabel!.trim() }] }
  }
}

/** The customer's ID / company number as SmartBee's `dealerNumber`: 5–9 digits, or null (not sent). */
export function dealerNumberOf(idNum: string | null | undefined): string | null {
  const digits = (idNum ?? '').replace(/\D/g, '')
  return digits.length >= 5 && digits.length <= 9 ? digits : null
}

/** The request body. Call only after `validateDocumentDraft` returned ok. Never carries the business token. */
export function buildSmartbeeBody(d: DocumentDraft, ids: { providerMsgId: string; providerMsgReferenceId: string }): SmartbeeDocumentBody {
  const dealerNumber = dealerNumberOf(d.customer.idNum)
  const body: SmartbeeDocumentBody = {
    providerMsgId: ids.providerMsgId,
    providerMsgReferenceId: ids.providerMsgReferenceId,
    customer: { name: d.customer.name.trim(), ...(dealerNumber ? { dealerNumber } : {}) },
    docType: d.docType,
    isDraft: false,
    createDraftOnFailure: false,
    creationMetadata: { language: 'HEB', sendOriginalToCustomer: false },
  }
  if (d.docType !== 'Receipt') {
    body.documentItems = { paymentItems: [{ description: d.description.trim(), quantity: 1, pricePerUnit: d.amount, vatOption: d.vatOption as SmartbeeVatOption }] }
  } else {
    body.comments = d.description.trim()
  }
  if (d.payment) body.receiptDetails = receiptDetails(d.payment)
  return body
}
