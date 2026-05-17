/**
 * Payment-method catalog for combined invoice/receipt documents.
 *
 * Mirrored by the CHECK constraint on bill_invoices.paymentMethod — the
 * migration is the source of truth for which values are storable; this
 * file is the source of truth for how they appear in the UI.
 *
 * Adding a new method: add it here AND widen the migration CHECK.
 */

export const PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'credit_card',
  'check',
  'digital',
  'other',
] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'מזומן' },
  { value: 'bank_transfer', label: 'העברה בנקאית' },
  { value: 'credit_card', label: 'כרטיס אשראי' },
  { value: 'check', label: 'שיק' },
  { value: 'digital', label: 'אמצעי דיגיטלי' },
  { value: 'other', label: 'אחר' },
] as const

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as ReadonlyArray<string>).includes(value)
}

export function paymentMethodLabel(value: string | null | undefined): string {
  if (!value) return ''
  return PAYMENT_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? ''
}
