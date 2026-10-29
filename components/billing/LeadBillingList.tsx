import Link from 'next/link'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import { formatCurrency } from '@/lib/funcs'
import type { UiLocale } from '@/lib/i18n/config'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { docStateLabel, formatInvoiceNumber } from './funcs'
import { DocStateChip, FulfillStateChip } from './chips'
import CreateInvoiceBtn from './CreateInvoiceBtn'

/**
 * The lead billing tab's document list (server component). Chrome, states and
 * kind names follow `locale` (resolved once by the page; default Hebrew) and
 * its root declares it. Amounts keep `formatCurrency` in every language:
 * document money follows the BILLING locale, never the interface language.
 * Invoice numbers are data.
 */
export default function LeadBillingList({
  leadId,
  invoices,
  canCreate,
  locale = 'he',
}: {
  leadId: number
  invoices: BillInvoiceRow[]
  canCreate: boolean
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <div className='py-4' {...regionAttrs(locale)}>
      <div className='flex justify-between items-end mb-4'>
        <h2 className='text-xl font-semibold'>{t('leadTabs.billing.title')}</h2>
        {canCreate && <CreateInvoiceBtn leadId={leadId} />}
      </div>

      {invoices.length === 0 ? (
        <EmptyState t={t} canCreate={canCreate} />
      ) : (
        <div className='border rounded-md bg-white overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr className='text-right'>
                <th className='px-3 py-2 font-semibold'>{t('leadTabs.billing.header.document')}</th>
                <th className='px-3 py-2 font-semibold'>{t('leadTabs.billing.header.status')}</th>
                <th className='px-3 py-2 font-semibold'>{t('leadTabs.billing.header.amount')}</th>
                <th className='px-3 py-2 font-semibold'>{t('leadTabs.billing.header.issuedAt')}</th>
                <th className='px-3 py-2 font-semibold'>{t('leadTabs.billing.header.dueAt')}</th>
                <th className='px-3 py-2'></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <InvoiceRow key={invoice.id} t={t} leadId={leadId} invoice={invoice} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function InvoiceRow({ t, leadId, invoice }: { t: Translator; leadId: number; invoice: BillInvoiceRow }) {
  const locale = t.locale
  const detailHref = `/clients/${leadId}/billing/${invoice.id}`
  const totalForDisplay = invoice.docState === 'draft' ? null : Number(invoice.totalAmount)

  return (
    <tr className='border-t'>
      <td className='px-3 py-2'>
        <Link href={detailHref} className='underline underline-offset-2 font-semibold'>
          {formatInvoiceNumber(invoice, locale)}
        </Link>
      </td>
      <td className='px-3 py-2'>
        <div className='flex gap-1.5 flex-wrap'>
          <DocStateChip state={invoice.docState} locale={locale} />
          <FulfillStateChip state={invoice.fulfillState} locale={locale} />
        </div>
      </td>
      <td className='px-3 py-2 tabular-nums'>
        {totalForDisplay == null ? <span className='text-gray-400'>—</span> : formatCurrency(totalForDisplay)}
      </td>
      <td className='px-3 py-2 tabular-nums'>{invoice.issuedAt ? formatLeadDate(locale, invoice.issuedAt) : <span className='text-gray-400'>—</span>}</td>
      <td className='px-3 py-2 tabular-nums'>{invoice.dueAt ? formatLeadDate(locale, invoice.dueAt) : <span className='text-gray-400'>—</span>}</td>
      <td className='px-3 py-2 text-end'>
        <Link href={detailHref} className='text-solid underline-offset-2 hover:underline'>
          {invoice.docState === 'draft' ? t('leadTabs.billing.edit') : t('leadTabs.billing.view')}
        </Link>
      </td>
    </tr>
  )
}

function EmptyState({ t, canCreate }: { t: Translator; canCreate: boolean }) {
  return (
    <div className='border border-dashed rounded-md bg-white text-center py-12 text-gray-500'>
      <p className='text-base mb-1'>{t('leadTabs.billing.empty.title')}</p>
      <p className='text-sm'>
        {canCreate ? t('leadTabs.billing.empty.canCreate') : t('leadTabs.billing.empty.noPermission')}
      </p>
    </div>
  )
}

export { docStateLabel }
