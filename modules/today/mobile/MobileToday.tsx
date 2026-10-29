import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import type { UiLocale } from '@/lib/i18n/config'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MobileTodayModel } from './viewModel'
import MobileTodayHero from './MobileTodayHero'
import MobileTodayRow from './MobileTodayRow'
import LeadListAddControl from '@/modules/leads/mobile/LeadListAddControl'

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
 *
 * ADDING A ליד IS REACHABLE FROM HERE. היום is the mobile landing screen, and
 * adding leads is the product's first priority action, but the only `+` lived on
 * the לידים tab — so the most important action in the product cost a tab switch
 * from the screen every session starts on. `LeadListAddControl` is the SHIPPED
 * control (header `+` → chooser → the existing form / import sheets); it is
 * mounted, not reimplemented, so both tabs open the same sheets and land on the
 * new lead the same way. `selecting` is false because היום has no selection mode.
 */
export default function MobileToday({
  model,
  whatsappConnected,
  locale = 'he',
}: {
  model: MobileTodayModel
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
  /** Interface language, resolved once on the server (DashboardPage). */
  locale?: UiLocale
}) {
  const { hero, nextUp, rest, remaining, restTotal, doneToday, meetings, newLeadsCount, tones } = model
  const t = translatorFor(locale)

  if (!hero && rest.length === 0 && nextUp.length === 0) {
    return (
      <>
        <LeadListAddControl selecting={false} />
        <MobileTodayClear doneToday={doneToday} meetings={meetings} newLeadsCount={newLeadsCount} locale={locale} />
      </>
    )
  }

  return (
    <div className='flex flex-col gap-2 px-4 pb-4 pt-2' {...regionAttrs(locale)}>
      <LeadListAddControl selecting={false} />
      {hero && (
        <MobileTodayHero row={hero} tones={tones?.[hero.id]} remaining={remaining} whatsappConnected={whatsappConnected} locale={locale} />
      )}

      {nextUp.length > 0 && (
        <RowSection id='next' title={t('today.mobile.later')} rows={nextUp} tones={tones} whatsappConnected={whatsappConnected} />
      )}

      {rest.length > 0 && (
        <>
          <RowSection
            id='rest'
            title={t('today.mobile.waitingCount', { count: restTotal })}
            rows={rest}
            tones={tones}
            whatsappConnected={whatsappConnected}
          />
          {restTotal > rest.length && (
            <p className='px-1 text-[12px] text-gray-400'>
              {t('today.mobile.showing', { shown: rest.length, total: restTotal })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function RowSection({
  id,
  title,
  rows,
  tones,
  whatsappConnected,
}: {
  id: string
  title: string
  rows: MobileTodayModel['rest']
  tones?: MobileTodayModel['tones']
  whatsappConnected?: boolean
}) {
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
          <MobileTodayRow key={row.id} row={row} tones={tones?.[row.id]} whatsappConnected={whatsappConnected} />
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
  locale,
}: {
  doneToday: number
  meetings: number
  newLeadsCount: number
  locale: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <div className='flex flex-col items-center gap-4 px-6 py-16 text-center' {...regionAttrs(locale)}>
      <span className='flex size-14 items-center justify-center rounded-full bg-success-bg'>
        <Icon name='check' type='sol' className='size-6 bg-success' />
      </span>
      <div className='max-w-[300px]'>
        <h2 className='text-lg font-bold text-ink'>{t('today.mobile.clearTitle')}</h2>
        <p className='mt-1 text-sm leading-relaxed text-gray-500'>
          {doneToday > 0 ? `${t('today.mobile.clearDone', { count: doneToday })} ` : ''}
          {t('today.mobile.allUpdated')}
        </p>
        {meetings > 0 && (
          <p className='mt-1 text-sm text-gray-500 tabular-nums'>{t('today.mobile.meetingsToday', { count: meetings })}</p>
        )}
      </div>
      <Link
        href={'/leads' as Route}
        className='flex min-h-11 items-center rounded-md border border-gray-200 bg-white px-5 font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {newLeadsCount > 0 ? t('today.mobile.newLeads', { count: newLeadsCount }) : t('today.mobile.allLeads')}
      </Link>
    </div>
  )
}
