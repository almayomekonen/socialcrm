import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import LeadContactActions from '@/modules/leads/mobile/LeadContactActions'
import type { MobileTodayRow } from './viewModel'
import { todayReasonTone, todayToneClass, todayWindowHintTone } from './reasonTone'

/**
 * "התחל כאן" — the one lead the rep should touch first, and the one loud action
 * on the mobile Today.
 *
 * There is exactly ONE of these per screen (ux-guidelines.md §5). Everything
 * below it is a quiet list row. The hero is the same pick the desktop dashboard
 * makes — `pickTopRecommended` decided it, and its Hebrew `reason` string came
 * with it — so a rep who checks their phone and then their laptop is told to
 * call the same person for the same stated reason.
 *
 * Server Component: no clock, no state, no hydration cost. The contact cluster
 * below is the one Client Component on the card, and `tel:` inside it stays a
 * real anchor because dialling is an OS navigation, not an app action.
 */
export default function MobileTodayHero({
  row,
  remaining,
  whatsappConnected,
}: {
  row: MobileTodayRow
  remaining?: number
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const { id, name, phone, reason, href, eyebrow, windowHint } = row
  const reasonTone = todayToneClass(todayReasonTone(reason))
  const hintTone = windowHint ? todayToneClass(todayWindowHintTone(windowHint)) : null
  const summary = remaining && remaining > 0 ? `${remaining} ממתינים` : ''

  return (
    <section aria-labelledby='mobile-today-hero' className='rounded-xl border border-gray-200 bg-white p-3.5'>
      <p id='mobile-today-hero' className='text-sm font-semibold text-primary-text'>
        {eyebrow || 'התחל כאן'}
        {summary ? <span className='font-medium text-gray-500'>{` · ${summary}`}</span> : null}
      </p>

      <Link
        href={href as Route}
        className='mt-1.5 block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <span className='block truncate text-xl font-bold leading-tight text-ink'>{name || '—'}</span>
        <span className={`mt-0.5 block truncate text-sm ${reasonTone ? `font-medium ${reasonTone.text}` : 'text-gray-600'}`}>
          {reason}
        </span>
        {windowHint && (
          <span className={`mt-0.5 block truncate text-sm ${hintTone ? `font-medium ${hintTone.text}` : 'text-gray-500'}`}>
            {windowHint}
          </span>
        )}
      </Link>

      <div className='mt-3 flex items-center gap-2'>
        {phone ? (
          <LeadContactActions leadId={id} phone={phone} name={name} size='bar' className='min-w-0 flex-1'  whatsappConnected={whatsappConnected} />
        ) : (
          <Link
            href={href as Route}
            className='press flex h-11 flex-1 items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            פתח ליד
          </Link>
        )}

        <Link
          href={href as Route}
          aria-label={name ? `פתח את ${name}` : 'פתח ליד'}
          className='press flex h-11 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <span className='text-[13px] font-medium text-gray-700'>פתח</span>
          <Icon name='angle-left' type='sol' className='size-3.5 bg-gray-600' />
        </Link>
      </div>
    </section>
  )
}
