import { DocStateChip } from '../chips'
import type { DocumentKind } from '@/db/billing/invoices'
import { documentKindLabel } from '@/lib/billing/documentKinds'

/**
 * Page header for the new-invoice editor: title, draft chip, subtitle,
 * "no autosave" annotation. Purely presentational — receives only the
 * lead name to mention in the subtitle.
 */
export default function InvoicePageHeader({
  leadName,
  kind = 'invoice',
}: {
  leadName: string
  kind?: DocumentKind
}) {
  const title = kind === 'invoice_receipt' ? 'חשבונית/קבלה חדשה' : 'חשבונית חדשה'
  return (
    <header className='flex items-start justify-between gap-4 flex-wrap'>
      <div className='min-w-0'>
        <div className='flex items-center gap-3 flex-wrap'>
          <h1 className='text-3xl leading-tight font-bold text-dark tracking-tight'>{title}</h1>
          <DocStateChip state='draft' />
          <span className='text-xs font-medium px-2 py-0.5 rounded bg-softy text-gray-700'>
            {documentKindLabel(kind)}
          </span>
        </div>
        <p className='mt-2 text-base text-gray-500'>
          מסמך חיוב חדש
          {leadName ? (
            <>
              {' '}
              עבור <span className='font-medium text-gray-700'>{leadName}</span>
            </>
          ) : null}
        </p>
      </div>
      <p className='text-sm text-gray-400 shrink-0 mt-2'>טיוטה · אין שמירה אוטומטית</p>
    </header>
  )
}
