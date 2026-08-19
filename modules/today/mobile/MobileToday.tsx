import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import type { MobileTodayModel } from './viewModel'
import MobileTodayHero from './MobileTodayHero'
import MobileTodayRow from './MobileTodayRow'

/**
 * Today, on a phone. The mobile answer to "what should I do right now?".
 *
 * SERVER COMPONENT and a pure function of `MobileTodayModel`. Every decision —
 * who is recommended, why, how many remain — was made upstream by the SAME
 * resolvers the desktop dashboard uses (`modules/today/queries.ts` or
 * `lib/today/service.ts`, normalised in `viewModel.ts`). This file renders; it
 * does not decide, does not fetch, and never reads a clock — so there is no
 * server/client business-day disagreement to have (architecture-rules.md §11).
 *
 * Not a port of the desktop dashboard: no progress bar, no three-up card grid,
 * no paginated table. One hero (with the remaining count in its header), then
 * the next-up and waiting lists — vertically scannable, action on the hero.
 */
export default function MobileToday({ model }: { model: MobileTodayModel }) {
  const { hero, nextUp, rest, remaining, restTotal, doneToday, meetings, newLeadsCount } = model

  if (!hero && rest.length === 0 && nextUp.length === 0) {
    return <MobileTodayClear doneToday={doneToday} meetings={meetings} newLeadsCount={newLeadsCount} />
  }

  return (
    <div className='flex flex-col gap-2 px-4 pb-4 pt-2'>
      {hero && (
        <MobileTodayHero row={hero} remaining={remaining} />
      )}

      {nextUp.length > 0 && <RowSection id='next' title='אחר כך' rows={nextUp} />}

      {rest.length > 0 && (
        <>
          <RowSection id='rest' title={`ממתינים (${restTotal})`} rows={rest} />
          {restTotal > rest.length && (
            <p className='px-1 text-[12px] text-gray-400'>
              {`מוצגים ${rest.length} מתוך ${restTotal}. השאר במסך הלידים.`}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function RowSection({ id, title, rows }: { id: string; title: string; rows: MobileTodayModel['rest'] }) {
  const headingId = `mobile-today-${id}`
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className='mb-1.5 px-1 text-sm font-semibold text-gray-500'>
        {title}
      </h2>
      {/* The hairlines live here so individual rows don't each carry a border
          and double up at the seams — the job `MobileList` used to do. */}
      <div className='divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white'>
        {rows.map((row) => (
          <MobileTodayRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  )
}

/**
 * Nothing is due. This is a RESULT, not an error — care-charter.md Law 4:
 * "הכול תחת שליטה" and stop beats manufacturing work to fill the screen. The
 * offered action is real and already exists; nothing here is a placeholder.
 */
function MobileTodayClear({
  doneToday,
  meetings,
  newLeadsCount,
}: {
  doneToday: number
  meetings: number
  newLeadsCount: number
}) {
  return (
    <div className='flex flex-col items-center gap-4 px-6 py-16 text-center'>
      <span className='flex size-14 items-center justify-center rounded-full bg-success-bg'>
        <Icon name='check' type='sol' className='size-6 bg-success' />
      </span>
      <div className='max-w-[300px]'>
        <h2 className='text-lg font-bold text-ink'>אין עכשיו מה לעשות</h2>
        <p className='mt-1 text-sm leading-relaxed text-gray-500'>
          {doneToday > 0 ? `סיימת ${doneToday} היום. ` : ''}
          כל המעקבים מעודכנים.
        </p>
        {meetings > 0 && <p className='mt-1 text-sm text-gray-500 tabular-nums'>{`${meetings} פגישות היום`}</p>}
      </div>
      <Link
        href={'/leads' as Route}
        className='flex min-h-11 items-center rounded-md border border-gray-200 bg-white px-5 font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {newLeadsCount > 0 ? `${newLeadsCount} לידים חדשים` : 'כל הלידים'}
      </Link>
    </div>
  )
}
