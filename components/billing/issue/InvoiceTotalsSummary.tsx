import { formatCurrency } from '@/lib/funcs'
import { cardCls, sectionHeaderCls, eyebrowCls } from './styles'

/**
 * Read-only summary panel: subtotal, tax, grand total. Pure props in,
 * JSX out — no computation, no state. The parent passes already-summed
 * totals.
 */
export default function InvoiceTotalsSummary({
  subtotal,
  tax,
  total,
}: {
  subtotal: number
  tax: number
  total: number
}) {
  return (
    <section className={'md:col-span-1 self-start ' + cardCls}>
      <div className={sectionHeaderCls}>
        <h2 className={eyebrowCls}>סיכום</h2>
      </div>
      <div className='px-6 py-6'>
        <dl className='grid grid-cols-2 gap-y-3 text-base'>
          <dt className='text-gray-500'>סכום ביניים</dt>
          <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(subtotal)}</dd>
          <dt className='text-gray-500'>מע"מ</dt>
          <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(tax)}</dd>
        </dl>
        <div className='mt-5 pt-5 border-t border-gray-200 flex items-baseline justify-between gap-3'>
          <span className='text-base font-semibold text-gray-700'>סה"כ לתשלום</span>
          <span className='text-3xl font-bold tabular-nums text-dark'>{formatCurrency(total)}</span>
        </div>
      </div>
    </section>
  )
}
