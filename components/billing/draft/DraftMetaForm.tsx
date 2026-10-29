'use client'

import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import type { BillInvoiceRow } from '@/db/billing/invoices'

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
  return (
    <details className='border-t border-gray-200 pt-4'>
      <summary className='cursor-pointer text-base font-medium text-gray-700 hover:text-gray-900 select-none'>
        אפשרויות נוספות
      </summary>
      <form onSubmit={onSubmit} className='grid gap-3 mt-3'>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
          <Input
            name='dueAt'
            type='date'
            lbl='תאריך פירעון'
            required={false}
            defaultValue={invoice.dueAt ?? ''}
          />
          <Input
            name='customerFooter'
            lbl='הערה ללקוח (תופיע על המסמך)'
            required={false}
            defaultValue={invoice.customerFooter}
          />
        </div>
        <Input
          name='internalNotes'
          as='textarea'
          lbl='הערות פנימיות (לא יופיעו על המסמך)'
          required={false}
          defaultValue={invoice.internalNotes}
        />
        <div className='flex justify-end'>
          <Btn variant='outline' lbl='שמור שינויים' icon='floppy-disk' type='submit' disabled={saving} />
        </div>
      </form>
    </details>
  )
}
