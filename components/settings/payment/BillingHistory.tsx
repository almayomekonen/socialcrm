import AccordionItem from '@/lib/AccordionItem'
import { formatRenewalDate } from './subscriptionDates'

/**
 * "היסטוריית חיובים" — the existing accordion, with the rows made readable.
 *
 * A row shows what the `payments` table actually records: the date of a
 * completed charge. The amount is not stored (the Grow webhook receives `sum`
 * and discards it) and no invoice document is generated, so neither column is
 * rendered rather than stamping today's price onto historical rows — a
 * customer who moved between monthly and annual would be shown a number they
 * could not reconcile.
 *
 * "שולם" is honest for every row here: a `payments` row is written inside the
 * webhook transaction only after a charge completes, so its existence IS the
 * paid state. There is no pending or failed row to distinguish it from.
 *
 * The transaction id stays as the reference the customer can quote to support —
 * it is the only receipt this system can currently point at, so it moves to a
 * secondary line instead of disappearing.
 */

export type Charge = {
  id: number | string
  transactionId: string
  createdAt: Date | string
}

export default function BillingHistory({ charges }: { charges: Charge[] }) {
  return (
    <section className='mt-10'>
      <h2 className='text-xl font-bold text-dark'>היסטוריית חיובים</h2>
      <div className='accordion mt-4 max-w-3xl'>
        <AccordionItem bodyClass='px-6 pb-2' title='צפייה בכל החיובים'>
          {charges.length === 0 ? (
            <div className='py-4'>
              <p className='text-sm text-gray-700'>עדיין לא בוצעו חיובים</p>
              <p className='mt-1 text-sm text-gray-500'>החיוב הראשון יופיע כאן מיד אחרי התשלום.</p>
            </div>
          ) : (
            <ul className='divide-y divide-gray-100'>
              {charges.map((charge) => (
                <li key={charge.id} className='flex items-center justify-between gap-4 py-4'>
                  <div className='min-w-0'>
                    <p className='text-sm text-gray-900'>
                      {formatRenewalDate(new Date(charge.createdAt), { withYear: true })}
                    </p>
                    <p className='mt-0.5 truncate font-mono text-xs text-gray-400'>{charge.transactionId}</p>
                  </div>
                  <span className='shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700'>
                    שולם
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AccordionItem>
      </div>
    </section>
  )
}
