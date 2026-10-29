'use client'

import { Input } from '@/lib/form'
import { cardCls, eyebrowCls } from './styles'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Collapsible "אפשרויות נוספות" section — due date, customer-facing
 * note, internal notes. Pure controlled inputs; parent owns state.
 */
export default function InvoiceMetadataDetails({
  dueAt,
  customerFooter,
  internalNotes,
  onDueAtChange,
  onCustomerFooterChange,
  onInternalNotesChange,
}: {
  dueAt: string
  customerFooter: string
  internalNotes: string
  onDueAtChange: (v: string) => void
  onCustomerFooterChange: (v: string) => void
  onInternalNotesChange: (v: string) => void
}) {
  const t = useT()
  const inputCls =
    'bg-gray-50! border-gray-300! hover:bg-white! hover:border-gray-400! focus:bg-white! transition-colors'
  return (
    <details className={'md:col-span-2 group self-start ' + cardCls}>
      <summary className='px-6 py-4 cursor-pointer select-none flex items-center justify-between hover:bg-gray-50/60 [&::-webkit-details-marker]:hidden'>
        <span className={eyebrowCls}>{t('billing.editor.meta.toggle')}</span>
        <span className='text-sm text-gray-400 group-open:rotate-180 transition-transform'>▾</span>
      </summary>
      <div className='px-6 py-6 border-t border-gray-100 grid gap-4'>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          <Input
            name='dueAt'
            type='date'
            lbl={t('billing.editor.meta.dueAt')}
            required={false}
            value={dueAt}
            onChange={(e) => onDueAtChange(e.target.value)}
            className={inputCls}
          />
          <Input
            name='customerFooter'
            lbl={t('billing.editor.meta.customerFooter')}
            required={false}
            value={customerFooter}
            onChange={(e) => onCustomerFooterChange(e.target.value)}
            className={inputCls}
          />
        </div>
        <Input
          name='internalNotes'
          as='textarea'
          lbl={t('billing.editor.meta.internalNotes')}
          required={false}
          value={internalNotes}
          onChange={(e) => onInternalNotesChange(e.target.value)}
          className={inputCls}
        />
      </div>
    </details>
  )
}
