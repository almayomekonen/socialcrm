export type InvoiceIssuedPayload = {
  documentNumber: number
  documentYear: number
  totalAmount: number
  subtotalAmount: number
  taxAmount: number
  currency: string
  locale: string
}

export function buildInvoiceIssuedPayload(input: InvoiceIssuedPayload): InvoiceIssuedPayload {
  return {
    documentNumber: input.documentNumber,
    documentYear: input.documentYear,
    totalAmount: round2(input.totalAmount),
    subtotalAmount: round2(input.subtotalAmount),
    taxAmount: round2(input.taxAmount),
    currency: input.currency,
    locale: input.locale,
  }
}

export type PaymentReceivedPayload = {
  paymentMethod: string
  paymentAmount: number
  paymentDate: string
  invoiceTotalAmount: number
  currency: string
}

export function buildPaymentReceivedPayload(input: PaymentReceivedPayload): PaymentReceivedPayload {
  return {
    paymentMethod: input.paymentMethod,
    paymentAmount: round2(input.paymentAmount),
    paymentDate: input.paymentDate,
    invoiceTotalAmount: round2(input.invoiceTotalAmount),
    currency: input.currency,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
