import type { Route } from 'next'
import MobileListRow, { MobileList } from '@/components/mobile/MobileListRow'
import { DESKTOP_URL_LABEL } from '@/lib/activation/mobileHandoffCopy'
import Icon from '@/lib/Icon'
import { logout } from '@/actions/auth'

/**
 * Presentation for the "עוד" tab. Split from the route so the viewport-QA
 * harness renders the REAL markup instead of a hand-copied approximation that
 * would drift the first time this file changes.
 */
export default function MobileMoreView({ name, email }: { name: string; email: string }) {
  return (
    <div className='flex flex-col gap-5 px-4 pb-8 pt-4'>
      <section aria-labelledby='more-available'>
        <h2 id='more-available' className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'>
          זמין בנייד
        </h2>
        <div className='overflow-hidden rounded-xl border border-gray-200 bg-white'>
          <MobileList>
            <MobileListRow
              href={'/settings/integrations' as Route}
              title='אינטגרציות'
              subtitle='וואטסאפ, פייסבוק ואינסטגרם'
              leading={<Tile icon='plug' />}
            />
            <MobileListRow
              href={'/support' as Route}
              title='תמיכה'
              subtitle='פתיחת פנייה ומעקב'
              leading={<Tile icon='life-ring' />}
            />
          </MobileList>
        </div>
      </section>

      <section aria-labelledby='more-desktop'>
        <h2 id='more-desktop' className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'>
          במחשב
        </h2>
        {/*
          Stated, not hidden. A rep who cannot find invoicing on their phone
          should learn in one line that it lives on the desktop — not hunt for a
          menu item that was quietly removed.
        */}
        <div className='rounded-xl border border-gray-200 bg-white p-4'>
          <p className='text-sm leading-relaxed text-gray-600'>
            ייבוא מאקסל, חשבוניות, דוחות, אוטומציות, ניהול משתמשים והגדרות מתקדמות זמינים בגרסת המחשב.
          </p>
          <p className='mt-2 text-[13px] text-gray-400' dir='ltr'>
            {DESKTOP_URL_LABEL}
          </p>
        </div>
      </section>

      <section aria-labelledby='more-account'>
        <h2 id='more-account' className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'>
          חשבון
        </h2>
        <div className='overflow-hidden rounded-xl border border-gray-200 bg-white'>
          <MobileList>
            <MobileListRow
              title={name}
              subtitle={email}
              leading={<Tile icon='user' />}
              // No href: identity display, not a destination. Editing the profile
              // is a desktop settings form (see the section above).
              trailing={<span className='text-[12px] text-gray-400'>מחובר</span>}
            />
            {/* The SAME `logout` server action the desktop nav calls — not a
                second sign-out path. In a <form action> it also works without
                client JS, and Next handles the POST + CSRF token itself. */}
            <form action={logout}>
              <button
                type='submit'
                className='flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start text-error-text transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
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

function Tile({ icon }: { icon: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <span className='flex size-9 items-center justify-center rounded-lg bg-primary-tint'>
      <Icon name={icon} type='sol' className='size-4 bg-primary' />
    </span>
  )
}
