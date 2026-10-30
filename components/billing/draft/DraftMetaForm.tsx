'use client'

import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The draft editor's collapsed "advanced options" (due date, customer note,
 * internal notes). Uncontrolled inputs seeded from the invoice; the parent
 * owns the submit.
 */
export default function DraftMetaForm({
  invoice,
  saving,
  onSubmit,
}: {
  invoice: BillInvoiceRow
  saving: boolean
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
}) {
  const t = useT()
  return (
    <details className='border-t border-gray-200 pt-4'>
      <summary className='cursor-pointer text-base font-medium text-gray-700 hover:text-gray-900 select-none'>
        {t('billing.editor.meta.toggle')}
      </summary>
      <form onSubmit={onSubmit} className='grid gap-3 mt-3'>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
          <Input
            name='dueAt'
            type='date'
            lbl={t('billing.editor.meta.dueAt')}
            required={false}
            defaultValue={invoice.dueAt ?? ''}
          />
          <Input
            name='customerFooter'
            lbl={t('billing.editor.meta.customerFooter')}
            required={false}
            defaultValue={invoice.customerFooter}
          />
        </div>
        <Input
          name='internalNotes'
          as='textarea'
          lbl={t('billing.editor.meta.internalNotes')}
          required={false}
          defaultValue={invoice.internalNotes}
        />
        <div className='flex justify-end'>
          <Btn variant='outline' lbl={t('billing.editor.meta.save')} icon='floppy-disk' type='submit' disabled={saving} />
        </div>
      </form>
    </details>
  )
}
