import type { ReactNode } from 'react'
import Link from 'next/link'
import SkipLink from '@/components/layout/SkipLink'

/**
 * The Support Center's chrome.
 *
 * DELIBERATELY THINNER than the (app) workspace, for two reasons.
 *
 * Technically: reproducing the left rail and copilot shell would need the
 * CopilotProvider / AwarenessProvider trees, and duplicating that here is the
 * drift architecture-rules.md forbids.
 *
 * Product: a customer whose workspace is BLOCKED can reach this page — that is
 * why the route group sits outside the product gate. Showing them a rail of
 * links they cannot open would be a lie at the exact moment they came for help.
 * /admin and /activate already work this way.
 *
 * There is no plan pill, no trial countdown, no upgrade control and no billing
 * language here, on purpose: this is a care surface (care-charter.md Laws 21,
 * 23) and the person reading it may have arrived precisely because they are
 * blocked. Monetising that moment is forbidden.
 *
 * It contributes NO heading of its own. Every page below supplies its own <h1>,
 * so the shell hosts the landing page and a conversation thread equally well.
 */
export default function SupportShell({
  displayName,
  children,
}: {
  /**
   * A resolved name, NOT the user record. The shell needs one string to greet
   * someone with; handing it the whole session object would put agencyId, role
   * and email into this subtree's serialized props for no reason. Minimal
   * props, minimal exposure.
   */
  displayName: string
  children: ReactNode
}) {
  return (
    <div dir='rtl' className='flex min-h-dvh flex-col bg-white'>
      <SkipLink />

      <header className='sticky top-0 z-50 w-full border-b border-gray-100 bg-white/90 backdrop-blur-lg'>
        <div className='mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4'>
          {/* Identity, not navigation: this is SocialCRM, and you are still
              inside it. The logo goes home rather than opening a support menu. */}
          <Link href='/dashboard' className='flex shrink-0 items-center gap-2'>
            <img src='/media/fav.svg' alt='' className='h-6' />
            <span className='text-base font-bold tracking-tight text-gray-800'>SocialCRM</span>
          </Link>

          <div className='flex min-w-0 items-center gap-4'>
            <span className='hidden truncate text-sm text-gray-500 desktop:inline'>
              {displayName}
            </span>
            {/* No directional arrow: a "back" glyph has to flip under RTL, and
                the word alone is unambiguous in both directions. */}
            <Link
              href='/dashboard'
              className='shrink-0 text-sm font-medium text-primary-text hover:underline'
            >
              חזרה למערכת
            </Link>
          </div>
        </div>
      </header>

      {/* max-w-3xl, narrower than the workspace: every Phase 2 screen is a
          single column of reading and one action. A wider measure would make it
          look like a dashboard. */}
      <main
        id='main-content'
        tabIndex={-1}
        className='mx-auto w-full max-w-3xl flex-1 px-4 py-8 focus:outline-none'
      >
        {children}
      </main>
    </div>
  )
}
