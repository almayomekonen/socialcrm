'use client'

import Icon from '@/lib/Icon'
import { useEntitlement } from '@/lib/entitlement/EntitlementContext'

/**
 * ONE expired-subscription surface, in three densities.
 *
 * The forensic audit found six different ways the product currently expresses a
 * single fact — a silent no-op, a raw React #441 dialog, "משהו השתבש, נסה שוב",
 * a permanent "בעיית חיבור — מנסה שוב" retry banner, a false "no notifications"
 * empty state, and a redirect to the marketing homepage. All of them describe a
 * lapsed subscription. This is the one component that says so.
 *
 * WHY THREE MODES INSTEAD OF A MODAL EVERYWHERE. A full-screen blocker is right
 * for a page whose whole purpose is gated, wrong for a disabled button, and
 * hostile inside a panel the user opened deliberately. Same words, same CTA,
 * three densities:
 *
 *   page   a centred state that replaces a route's body, inside the app shell
 *   panel  fills a feature region (the AI panel, a locked composer)
 *   inline a compact strip for banners, dropdowns and result areas
 *
 * NEVER "נסה שוב". A lapsed subscription is not a transient failure and retrying
 * cannot succeed; offering a retry is what made the audit's testers read this as
 * an outage. The only forward action is renewal.
 *
 * THE CTA IS A LINK, NOT AN EFFECT. `/api/payments/upgrade` is the EXISTING
 * upgrade route; it creates the pending-upgrade row and redirects to Grow when
 * VISITED. Rendering this component performs no request and mutates nothing —
 * the write happens on click, which is the requirement that the renewal CTA must
 * not change subscription state merely by being displayed.
 */

export type ExpiredMode = 'page' | 'panel' | 'inline'

const TITLE = 'המנוי שלך הסתיים'

/** Trial-never-started is a different sentence from a lapsed paid plan. */
function bodyFor(status: string): string {
  if (status === 'NEVER_STARTED') {
    return 'הפעילו את המנוי כדי להשתמש ביכולות המתקדמות. כל הלידים והשיחות שלכם שמורים וימשיכו להיות זמינים.'
  }
  return 'היכולות המתקדמות מושהות כרגע. כל הלידים, השיחות וההיסטוריה שלכם שמורים — חידוש המנוי מחזיר את הגישה מיד.'
}

function ctaHref(source: string): string {
  return `/api/payments/upgrade?source=${encodeURIComponent(source)}`
}

export default function SubscriptionExpiredState({
  mode = 'panel',
  /** Analytics attribution on the existing upgrade route. */
  source = 'entitlement_state',
  /** Optional one-line override naming the specific capability that is paused. */
  feature,
  className = '',
}: {
  mode?: ExpiredMode
  source?: string
  feature?: string
  className?: string
}) {
  const { status, expiresAt } = useEntitlement()

  const lapsed = expiresAt
    ? new Date(expiresAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  const cta = (
    <a
      href={ctaHref(source)}
      className='press inline-flex min-h-11 items-center justify-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      חידוש מנוי
    </a>
  )

  if (mode === 'inline') {
    return (
      <div
        data-testid='subscription-expired-inline'
        className={`flex flex-wrap items-center gap-3 rounded-lg border border-warning-border bg-warning-bg px-3.5 py-3 ${className}`}
      >
        <Icon name='lock' type='sol' className='size-4 shrink-0 bg-warning-text' />
        <p className='min-w-0 flex-1 text-[13px] leading-snug text-warning-text'>
          {feature ? `${feature} — ${TITLE}` : TITLE}
        </p>
        <a
          href={ctaHref(source)}
          className='shrink-0 text-[13px] font-semibold text-warning-text underline underline-offset-2'
        >
          חידוש מנוי
        </a>
      </div>
    )
  }

  const pad = mode === 'page' ? 'px-6 py-16' : 'px-6 py-12'

  return (
    <div
      data-testid='subscription-expired-state'
      className={`flex flex-col items-center gap-4 text-center ${pad} ${className}`}
    >
      <span className='flex size-14 items-center justify-center rounded-full bg-gray-100'>
        <Icon name='lock' type='sol' className='size-6 bg-gray-500' />
      </span>

      <div className='max-w-[380px]'>
        <h2 className='text-lg font-bold text-ink'>{TITLE}</h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>{feature ? `${feature} ${bodyFor(status)}` : bodyFor(status)}</p>
        {lapsed && <p className='mt-1.5 text-[13px] text-gray-400'>{`תוקף המנוי הסתיים ב-${lapsed}`}</p>}
      </div>

      {cta}
    </div>
  )
}
