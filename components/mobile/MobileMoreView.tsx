import type { Route } from 'next'
import MobileListRow, { MobileList } from '@/components/mobile/MobileListRow'
import { DESKTOP_URL_LABEL } from '@/lib/activation/mobileHandoffCopy'
import Icon, { type IconNames } from '@/lib/Icon'
import { logout } from '@/actions/auth'
import {
  MORE_SECTION_LABELS,
  MORE_SECTION_ORDER,
  itemsForSection,
  type MoreItem,
} from './moreDestinations'

/**
 * The "עוד" hub — the mobile settings map.
 *
 * EVERY ROW LANDS ON ITS DESTINATION. The settings nav column is gated out of
 * the mobile workspace (`app/(app)/settings/layout.tsx` → `SettingsChrome`), so
 * tapping "אינטגרציות" opens the Integrations content itself rather than an
 * eighteen-item menu with the content below the fold. Nothing here scrolls the
 * user to a section; nothing here is a category that opens another list.
 *
 * Server Component — a list of links needs no client runtime. Role gating comes
 * from `visibleMoreItems`, resolved by the route.
 */
export default function MobileMoreView({
  name,
  email,
  items,
}: {
  name: string
  email: string
  items: MoreItem[]
}) {
  return (
    <div className='flex flex-col gap-5 px-4 pb-8 pt-4'>
      {MORE_SECTION_ORDER.map((section) => {
        const sectionItems = itemsForSection(items, section)
        if (sectionItems.length === 0) return null
        return (
          <section key={section} aria-labelledby={`more-${section}`}>
            <h2
              id={`more-${section}`}
              className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'
            >
              {MORE_SECTION_LABELS[section]}
            </h2>
            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white'>
              <MobileList>
                {sectionItems.map((item) => (
                  <MobileListRow
                    key={item.href}
                    href={item.href as Route}
                    title={item.title}
                    subtitle={item.subtitle}
                    leading={<Tile icon={item.icon} />}
                  />
                ))}
              </MobileList>
            </div>
          </section>
        )
      })}

      {/*
        Stated, not hidden. A rep who cannot find invoicing on their phone should
        learn in one line that it lives on the desktop — not hunt for a menu item
        that was quietly removed (mobile-parity-matrix.md, RED tier).
      */}
      <section aria-labelledby='more-desktop'>
        <h2 id='more-desktop' className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'>
          במחשב
        </h2>
        <div className='rounded-xl border border-gray-200 bg-white p-4'>
          <p className='text-sm leading-relaxed text-gray-600'>
            ייבוא מאקסל, חשבוניות, דוחות ואוטומציות זמינים בגרסת המחשב.
          </p>
          <p className='mt-2 text-[13px] text-gray-400' dir='ltr'>
            {DESKTOP_URL_LABEL}
          </p>
        </div>
      </section>

      <section aria-labelledby='more-session'>
        <h2 id='more-session' className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'>
          {MORE_SECTION_LABELS.account}
        </h2>
        <div className='overflow-hidden rounded-xl border border-gray-200 bg-white'>
          <MobileList>
            <MobileListRow
              title={name}
              subtitle={email}
              leading={<Tile icon='user' />}
              // No href: identity display, not a destination. Editing the
              // profile is the "פרופיל אישי" row above.
              trailing={<span className='text-[12px] text-gray-400'>מחובר</span>}
            />
            {/* The SAME `logout` server action the desktop nav calls — not a
                second sign-out path. In a <form action> it also works without
                client JS, and Next handles the POST + CSRF token itself. */}
            <form action={logout}>
              <button
                type='submit'
                className='flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start text-error-text transition-colors hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
              >
                <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-error-bg'>
                  <Icon name='arrow-right-from-bracket' type='sol' className='size-4 bg-error' />
                </span>
                <span className='text-[15px] font-semibold'>התנתקות</span>
              </button>
            </form>
          </MobileList>
        </div>
      </section>
    </div>
  )
}

function Tile({ icon }: { icon: IconNames }) {
  return (
    <span className='flex size-9 items-center justify-center rounded-lg bg-primary-tint'>
      <Icon name={icon} type='sol' className='size-4 bg-primary' />
    </span>
  )
}
