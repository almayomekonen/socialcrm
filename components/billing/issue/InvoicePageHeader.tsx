import { DocStateChip } from '../chips'
import type { DocumentKind } from '@/db/billing/invoices'
import { useT } from '@/lib/i18n/I18nProvider'
import { documentKindDisplay } from '../labels'

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
  const t = useT()
  const title = kind === 'invoice_receipt' ? t('billing.editor.header.title.invoice_receipt') : t('billing.editor.header.title.invoice')
  return (
    <header className='flex items-start justify-between gap-4 flex-wrap'>
      <div className='min-w-0'>
        <div className='flex items-center gap-3 flex-wrap'>
          <h1 className='text-3xl leading-tight font-bold text-dark tracking-tight'>{title}</h1>
          <DocStateChip state='draft' locale={t.locale} />
          <span className='text-xs font-medium px-2 py-0.5 rounded bg-softy text-gray-700'>
            {documentKindDisplay(kind, t.locale)}
          </span>
        </div>
        <p className='mt-2 text-base text-gray-500'>
          {t('billing.editor.header.subtitle')}
          {leadName ? (
            <>
              {' '}
              {t('billing.editor.header.subtitleFor')} <span className='font-medium text-gray-700'>{leadName}</span>
            </>
          ) : null}
        </p>
      </div>
      <p className='text-sm text-gray-400 shrink-0 mt-2'>{t('billing.editor.header.noAutosave')}</p>
    </header>
  )
}
