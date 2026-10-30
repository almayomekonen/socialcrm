import { formatCurrency } from '@/lib/funcs'
import type { QuoteTotals } from '@/lib/quotes/totals'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The composer's totals: subtotal, discount when there is one, VAT and the
 * amount due — figures from `computeQuoteTotals`, money as `formatCurrency`.
 *
 * Extracted from QuoteComposer, which was at the edge of the file-size soft
 * limit (architecture-rules §7). Unchanged markup.
 */

/** `formatCurrency` widens to `string | number` for NaN; the document wants text. */
const money = (n: number): string => String(formatCurrency(n))

export default function QuoteComposerTotals({ totals, taxRatePercent }: { totals: QuoteTotals; taxRatePercent: number }) {
  const t = useT()
  return (
    <dl className='mt-3 border-t border-gray-100 pt-3 grid gap-1.5 text-sm'>
      <Row label={t('admin.automationTemplates.composer.subtotal')} value={money(totals.subtotalAmount)} />
      {totals.discountAmount > 0 && (
        <Row label={t('admin.quotes.items.discount')} value={`־${money(totals.discountAmount)}`} />
      )}
      <Row label={t('admin.automationTemplates.composer.vat', { rate: String(taxRatePercent) })} value={money(totals.taxAmount)} />
      <div className='flex items-baseline justify-between gap-3 border-t border-gray-100 pt-2 mt-0.5'>
        <dt className='text-[15px] font-semibold text-gray-800'>{t('admin.automationTemplates.composer.total')}</dt>
        <dd className='text-[17px] font-semibold text-gray-900 tabular-nums'>
          {money(totals.totalAmount)}
        </dd>
      </div>
    </dl>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <dt className='text-gray-500'>{label}</dt>
      <dd className='text-gray-700 tabular-nums'>{value}</dd>
    </div>
  )
}
