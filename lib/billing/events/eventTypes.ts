export const INVOICE_EVENTS = {
  DRAFTED: 'invoice.drafted',
  UPDATED: 'invoice.updated',
  ISSUED: 'invoice.issued',
  VOIDED: 'invoice.voided',
  REPLACED: 'invoice.replaced',
  SENT: 'invoice.sent',
} as const

export const PAYMENT_EVENTS = {
  RECEIVED: 'payment.received',
} as const

export const PROJECTION_EVENTS = {
  FULFILL_STATE_RECOMPUTED: 'projection.fulfill_state_recomputed',
  OVERDUE_FLAGGED: 'projection.overdue_flagged',
} as const

export type InvoiceEventType = (typeof INVOICE_EVENTS)[keyof typeof INVOICE_EVENTS]
export type PaymentEventType = (typeof PAYMENT_EVENTS)[keyof typeof PAYMENT_EVENTS]
export type ProjectionEventType = (typeof PROJECTION_EVENTS)[keyof typeof PROJECTION_EVENTS]

export type EventType = InvoiceEventType | PaymentEventType | ProjectionEventType
