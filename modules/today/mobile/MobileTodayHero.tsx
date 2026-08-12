import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import type { MobileTodayRow } from './viewModel'

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
 * Server Component: no clock, no state, no hydration cost. The only interactive
 * parts are two links, and `tel:` is a real navigation (see MobileLeadCallButton
 * for why that is deliberate).
 */
export default function MobileTodayHero({ row }: { row: MobileTodayRow }) {
  const { name, phone, reason, href } = row

  return (
    <section aria-labelledby='mobile-today-hero' className='rounded-xl border border-primary/30 bg-primary-tint/40 p-4'>
      <p id='mobile-today-hero' className='text-[11px] font-semibold uppercase tracking-wide text-primary-text'>
        התחל כאן
      </p>

      <Link
        href={href as Route}
        className='mt-1 block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <span className='block truncate text-xl font-bold leading-tight text-ink'>{name || '—'}</span>
        <span className='mt-0.5 block truncate text-sm text-gray-600'>{reason}</span>
      </Link>

      <div className='mt-3 flex items-center gap-2'>
        {phone ? (
          <a
            href={`tel:${phone}`}
            aria-label={name ? `התקשר ל${name}` : 'התקשר'}
            /* h-11 = 44px. Full-width primary: on a phone the loudest action
               should be the easiest to hit, not a small pill in a corner. */
            className='flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='phone' type='sol' className='size-4 bg-white' />
            <span>התקשר</span>
          </a>
        ) : (
          /* No phone is not a dead end — the lead detail still has email,
             WhatsApp and the full history. */
          <Link
            href={href as Route}
            className='flex h-11 flex-1 items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85'
          >
            פתח ליד
          </Link>
        )}

        <Link
          href={href as Route}
          aria-label={name ? `פתח את ${name}` : 'פתח ליד'}
          className='flex size-11 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <Icon name='angle-left' type='sol' className='size-4 bg-gray-600' />
        </Link>
      </div>
    </section>
  )
}
