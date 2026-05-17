'use client'

import { Input, Select } from '@/lib/form'
import { formatCurrency } from '@/lib/funcs'
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '@/lib/billing/payment/methods'

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
  const showAmountHint = amount != null && Math.abs(amount - invoiceTotal) > 0.0001 && amount < invoiceTotal
  return (
    <section className='bg-white border border-gray-200 rounded-xl p-5 grid gap-4'>
      <div className='flex items-baseline justify-between gap-3'>
        <h3 className='text-xs font-semibold uppercase tracking-[0.08em] text-gray-500'>
          פרטי תשלום שהתקבל
        </h3>
        <p className='text-sm text-gray-400 tabular-nums'>סה"כ {formatCurrency(invoiceTotal)}</p>
      </div>

      <div className='grid gap-3 md:grid-cols-3'>
        <Select
          lbl='אמצעי תשלום'
          value={method}
          onChange={(e: any) => onMethodChange((e.target.value as PaymentMethod | '') || '')}
          options={PAYMENT_METHOD_OPTIONS.map((o) => ({ id: o.value, name: o.label }))}
          val='id'
          show='name'
          placeholder='בחרו'
          required={false}
          disabled={disabled}
        />

        <Input
          lbl='סכום ששולם'
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
          lbl='תאריך תשלום'
          type='date'
          value={date}
          onChange={(e: any) => onDateChange(e.target.value)}
          required={false}
          disabled={disabled}
        />
      </div>

      {showAmountHint && (
        <p className='text-xs text-gray-500'>
          הסכום שהתקבל נמוך מסך החשבונית — המסמך ייווצר כתשלום חלקי.
        </p>
      )}
    </section>
  )
}
