import { describe, expect, it } from 'vitest'
import { allowedDocTypes, buildSmartbeeBody, validateDocumentDraft, type DocumentDraft } from '@/lib/integrations/providers/smartbee/payload'

/** SmartBee's DocumentRequest rules, refused before any call. Pure. */

const cash = (amount: number) => ({ method: 'cash' as const, amount, paidOn: null, installments: null, checkNumber: null, reference: null, otherLabel: null })
const draft = (over: Partial<DocumentDraft> = {}): DocumentDraft => ({
  docType: 'InvoiceReceipt',
  description: 'צילום חתונה',
  amount: 1500,
  vatOption: 'Include',
  payment: cash(1500),
  customer: { name: 'יוסי כהן', idNum: null },
  ...over,
})
const ids = { providerMsgId: 'scrm-test-act_1', providerMsgReferenceId: 'scrm-a1-l2' }

describe('business type', () => {
  it('an עוסק פטור issues receipts only', () => {
    expect(allowedDocTypes('exempt')).toEqual(['Receipt'])
    expect(validateDocumentDraft(draft(), 'exempt')).toEqual({ ok: false, reason: 'doc_type_not_allowed' })
    expect(validateDocumentDraft(draft({ docType: 'Invoice', payment: null }), 'exempt')).toEqual({ ok: false, reason: 'doc_type_not_allowed' })
    expect(validateDocumentDraft(draft({ docType: 'Receipt', vatOption: null }), 'exempt')).toEqual({ ok: true })
  })
  it('an עוסק מורשה and a company issue all three', () => {
    for (const t of ['authorized', 'company'] as const) expect(allowedDocTypes(t)).toEqual(['Invoice', 'Receipt', 'InvoiceReceipt'])
  })
})

describe('per document type', () => {
  it('Invoice: line item and VAT basis, never a payment', () => {
    expect(validateDocumentDraft(draft({ docType: 'Invoice', payment: null, vatOption: null }), 'authorized')).toEqual({ ok: false, reason: 'vat_required' })
    expect(validateDocumentDraft(draft({ docType: 'Invoice' }), 'authorized')).toEqual({ ok: false, reason: 'payment_not_allowed' })
    expect(validateDocumentDraft(draft({ docType: 'Invoice', payment: null, vatOption: 'NotInclude' }), 'authorized')).toEqual({ ok: true })
  })
  it('Receipt and InvoiceReceipt need a payment equal to the amount', () => {
    expect(validateDocumentDraft(draft({ docType: 'Receipt', payment: null }), 'authorized')).toEqual({ ok: false, reason: 'payment_required' })
    expect(validateDocumentDraft(draft({ payment: cash(1400) }), 'authorized')).toEqual({ ok: false, reason: 'payment_amount_mismatch' })
  })
  it('InvoiceReceipt only for a price that includes VAT: we never compute VAT', () => {
    expect(validateDocumentDraft(draft({ vatOption: 'NotInclude' }), 'authorized')).toEqual({ ok: false, reason: 'invoice_receipt_needs_incl_vat' })
  })
  it('amounts: positive, at most two decimals, within SmartBee range', () => {
    for (const amount of [0, -5, 1.005, 10_000_000, Number.NaN]) expect(validateDocumentDraft(draft({ amount, payment: cash(amount) }), 'authorized').ok).toBe(false)
    expect(validateDocumentDraft(draft({ amount: 99.9, payment: cash(99.9) }), 'authorized')).toEqual({ ok: true })
  })
  it('payment details: check number, other label, installments', () => {
    const p = cash(1500)
    expect(validateDocumentDraft(draft({ payment: { ...p, method: 'check' } }), 'authorized')).toEqual({ ok: false, reason: 'check_number_required' })
    expect(validateDocumentDraft(draft({ payment: { ...p, method: 'other' } }), 'authorized')).toEqual({ ok: false, reason: 'other_label_required' })
    expect(validateDocumentDraft(draft({ payment: { ...p, method: 'credit_card', installments: 100 } }), 'authorized')).toEqual({ ok: false, reason: 'installments_invalid' })
    expect(validateDocumentDraft(draft({ payment: { ...p, paidOn: '2026-02-30' } }), 'authorized')).toEqual({ ok: false, reason: 'paid_on_invalid' })
  })
  it('customer name 2–100 characters', () => {
    expect(validateDocumentDraft(draft({ customer: { name: 'א', idNum: null } }), 'authorized')).toEqual({ ok: false, reason: 'customer_name_invalid' })
  })
})

describe('the request body', () => {
  it('never emails the customer, never a draft, never carries the business token or contact details', () => {
    const body = buildSmartbeeBody(draft({ customer: { name: 'יוסי כהן', idNum: '012345678' } }), ids)
    expect(body.creationMetadata).toEqual({ language: 'HEB', sendOriginalToCustomer: false })
    expect(body.isDraft).toBe(false)
    expect(body.createDraftOnFailure).toBe(false)
    expect(body.customer).toEqual({ name: 'יוסי כהן', dealerNumber: '012345678' })
    const json = JSON.stringify(body)
    for (const k of ['providerUserToken', 'providerCustomerId', 'email', 'mainPhone']) expect(json).not.toContain(k)
  })
  it('InvoiceReceipt: one line, quantity 1, VAT included, payment equal', () => {
    const body = buildSmartbeeBody(draft(), ids)
    expect(body).toMatchObject({ providerMsgId: 'scrm-test-act_1', providerMsgReferenceId: 'scrm-a1-l2', docType: 'InvoiceReceipt' })
    expect(body.documentItems).toEqual({ paymentItems: [{ description: 'צילום חתונה', quantity: 1, pricePerUnit: 1500, vatOption: 'Include' }] })
    expect(body.receiptDetails).toEqual({ cashItems: [{ sum: 1500 }] })
  })
  it('Receipt: no line items; the description goes to comments', () => {
    const body = buildSmartbeeBody(draft({ docType: 'Receipt', vatOption: null }), ids)
    expect(body.documentItems).toBeUndefined()
    expect(body.comments).toBe('צילום חתונה')
  })
  it('payment methods map to the documented items', () => {
    const p = cash(1500)
    expect(buildSmartbeeBody(draft({ payment: { ...p, method: 'credit_card', installments: 3 } }), ids).receiptDetails).toEqual({
      creditCardItems: [{ sum: 1500, creditCardType: 'Other', creditDealType: 'Installments', installmentsNumber: 3 }],
    })
    expect(buildSmartbeeBody(draft({ payment: { ...p, method: 'credit_card' } }), ids).receiptDetails?.creditCardItems?.[0]).toMatchObject({ creditDealType: 'Regular', installmentsNumber: 1 })
    expect(buildSmartbeeBody(draft({ payment: { ...p, method: 'check', checkNumber: '1234' } }), ids).receiptDetails).toEqual({ checkItems: [{ sum: 1500, checkId: '1234' }] })
    expect(buildSmartbeeBody(draft({ payment: { ...p, method: 'bank_transfer', reference: 'R55' } }), ids).receiptDetails).toEqual({ wireTransferItems: [{ sum: 1500, referenceNum: 'R55' }] })
    expect(buildSmartbeeBody(draft({ payment: { ...p, method: 'other', otherLabel: 'ביט' } }), ids).receiptDetails).toEqual({ otherItems: [{ sum: 1500, description: 'ביט' }] })
  })
  it('an ID number that is not 5–9 digits is not sent', () => {
    expect(buildSmartbeeBody(draft({ customer: { name: 'יוסי כהן', idNum: '12' } }), ids).customer).toEqual({ name: 'יוסי כהן' })
  })
})
