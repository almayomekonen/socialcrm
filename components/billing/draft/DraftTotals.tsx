import { formatCurrency } from '@/lib/funcs'

/** The draft editor's totals block. Already-summed legal totals in, JSX out. */
export default function DraftTotals({ subtotal, tax, total }: { subtotal: number; tax: number; total: number }) {
  return (
    <section className='bg-gray-50 rounded-lg p-5'>
      <dl className='grid grid-cols-2 gap-y-2 text-base max-w-sm ms-auto'>
        <dt className='text-gray-500'>סכום ביניים</dt>
        <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(subtotal)}</dd>
        <dt className='text-gray-500'>מע"מ</dt>
        <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(tax)}</dd>
        <dt className='font-semibold border-t pt-3 mt-2 text-base text-gray-700'>סה"כ לתשלום</dt>
        <dd className='font-bold tabular-nums text-end border-t pt-3 mt-2 text-2xl text-dark'>
          {formatCurrency(total)}
        </dd>
      </dl>
    </section>
  )
}
