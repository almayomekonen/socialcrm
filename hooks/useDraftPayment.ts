'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/funcs'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import type { PaymentMethod } from '@/lib/billing/payment/methods'
import { updateDraftKindAndPaymentAction } from '@/actions/billing/drafts'

/**
 * The draft editor's payment block state (combined invoice/receipt only):
 * seeded from the stored draft, each change persisted immediately; a failed
 * save refreshes back to the server's values. `errorMessage` is the failure
 * toast the caller words.
 */
export function useDraftPayment(invoice: BillInvoiceRow, errorMessage: string) {
  const router = useRouter()
  const isCombinedDoc = invoice.kind === 'invoice_receipt'
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(
    (invoice.paymentMethod as PaymentMethod | null) ?? '',
  )
  const [paymentAmount, setPaymentAmount] = useState<number | null>(invoice.paymentAmount)
  const [paymentDate, setPaymentDate] = useState<string>(
    invoice.paymentDate ?? new Date().toISOString().slice(0, 10),
  )

  async function persistPayment(next: {
    method?: PaymentMethod | ''
    amount?: number | null
    date?: string
  }): Promise<void> {
    if (!isCombinedDoc) return
    if (savingPayment) return
    setSavingPayment(true)
    const method = next.method ?? paymentMethod
    const amount = next.amount === undefined ? paymentAmount : next.amount
    const date = next.date ?? paymentDate
    const result = await api(
      updateDraftKindAndPaymentAction,
      [
        {
          invoiceId: invoice.id,
          leadId: invoice.leadId,
          kind: 'invoice_receipt',
          paymentMethod: (method || null) as PaymentMethod | null,
          paymentAmount: amount,
          paymentDate: date || null,
        },
      ],
      undefined,
      errorMessage,
      { silentSuccess: true },
    )
    setSavingPayment(false)
    if (!result || !('success' in result) || !result.success) router.refresh()
  }

  return {
    isCombinedDoc,
    savingPayment,
    paymentMethod,
    paymentAmount,
    paymentDate,
    onMethodChange: (v: PaymentMethod | '') => {
      setPaymentMethod(v)
      void persistPayment({ method: v })
    },
    onAmountChange: (v: number | null) => {
      setPaymentAmount(v)
      void persistPayment({ amount: v })
    },
    onDateChange: (v: string) => {
      setPaymentDate(v)
      void persistPayment({ date: v })
    },
  }
}
