'use client'

import { Input, Select } from '@/lib/form'
import { formatCurrency } from '@/lib/funcs'
import type { PaymentMethod } from '@/lib/billing/payment/methods'
import { useT } from '@/lib/i18n/I18nProvider'
import { paymentMethodOptions } from '../labels'

/**
 * Reusable payment block. Mounted by both the new-editor (transient state)
 * and the draft-editor (server-persisted state). Owns no state itself — the
 * parent provides values + setters. Single payment method per receipt, per
 * MVP scope; multi-method support is a future addition.
 *
 * Visual layout follows the rest of the editor: card-style container with
 * the eyebrow heading + three controls in a single row on desktop.
 */

export default function PaymentSection({
  method,
  amount,
  date,
  invoiceTotal,
  onMethodChange,
  onAmountChange,
  onDateChange,
  disabled,
}: {
  method: PaymentMethod | ''
  amount: number | null
  date: string
  invoiceTotal: number
  onMethodChange: (v: PaymentMethod | '') => void
  onAmountChange: (v: number | null) => void
  onDateChange: (v: string) => void
  disabled?: boolean
}) {
  const t = useT()
  const showAmountHint = amount != null && Math.abs(amount - invoiceTotal) > 0.0001 && amount < invoiceTotal
  return (
    <section className='bg-white border border-gray-200 rounded-xl p-5 grid gap-4'>
      <div className='flex items-baseline justify-between gap-3'>
        <h3 className='text-xs font-semibold uppercase tracking-[0.08em] text-gray-500'>
          {t('billing.editor.payment.heading')}
        </h3>
        <p className='text-sm text-gray-400 tabular-nums'>{t('billing.editor.payment.total', { amount: formatCurrency(invoiceTotal) })}</p>
      </div>

      <div className='grid gap-3 md:grid-cols-3'>
        <Select
          lbl={t('billing.editor.payment.method')}
          value={method}
          onChange={(e: any) => onMethodChange((e.target.value as PaymentMethod | '') || '')}
          options={paymentMethodOptions(t.locale)}
          val='id'
          show='name'
          placeholder={t('billing.editor.payment.methodPlaceholder')}
          required={false}
          disabled={disabled}
        />

        <Input
          lbl={t('billing.editor.payment.amount')}
          type='number'
          step='0.01'
          min='0'
          value={amount == null ? '' : String(amount)}
          onChange={(e: any) => {
            const raw = e.target.value
            if (raw === '') return onAmountChange(null)
            const n = Number(raw)
            onAmountChange(Number.isFinite(n) ? n : null)
          }}
          required={false}
          disabled={disabled}
        />

        <Input
          lbl={t('billing.editor.payment.date')}
          type='date'
          value={date}
          onChange={(e: any) => onDateChange(e.target.value)}
          required={false}
          disabled={disabled}
        />
      </div>

      {showAmountHint && (
        <p className='text-xs text-gray-500'>
          {t('billing.editor.payment.partialHint')}
        </p>
      )}
    </section>
  )
}
