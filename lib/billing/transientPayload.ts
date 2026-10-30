import type { DocumentKind } from '@/db/billing/invoices'
import type { PaymentMethod } from '@/lib/billing/payment/methods'
import type { TransientLineInput } from '@/actions/billing/drafts'

/**
 * The new-invoice editor's save / issue payload, built from its browser-held
 * state. Pure; same shape the editor always sent.
 */
export function buildTransientPayload(input: {
  leadId: number
  dueAt: string
  customerFooter: string
  internalNotes: string
  lines: ReadonlyArray<{ title: string; description: string; quantity: number; unitPrice: number; discount: number }>
  kind: DocumentKind
  isCombinedDoc: boolean
  paymentMethod: PaymentMethod | ''
  paymentAmount: number | null
  paymentDate: string
}) {
  const { leadId, dueAt, customerFooter, internalNotes, lines, kind, isCombinedDoc, paymentMethod, paymentAmount, paymentDate } = input
  return {
    leadId,
    meta: { dueAt: dueAt || null, customerFooter, internalNotes },
    lines: lines.map((line) => ({
      title: line.title,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
    })) as TransientLineInput[],
    kind,
    payment: isCombinedDoc
      ? {
          method: (paymentMethod || null) as PaymentMethod | null,
          amount: paymentAmount,
          date: paymentDate || null,
        }
      : undefined,
  }
}
