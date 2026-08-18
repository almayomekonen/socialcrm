import Link from 'next/link'
import type { Route } from 'next'
import Icon, { type IconNames } from '@/lib/Icon'
import CopyDesktopLink from './CopyDesktopLink'
import { DESKTOP_URL_LABEL } from '@/lib/activation/mobileHandoffCopy'

/**
 * "This section is not on the phone yet."
 *
 * The honest alternative to two bad options: shipping the desktop table into a
 * 360px viewport, or shipping a tab that does nothing. It states the situation
 * plainly, offers a REAL action that exists today, and names where the full
 * workflow lives — the same stance `MobileHandoff` takes, at section scale
 * (care-charter.md §4: say something true and useful, or say nothing).
 *
 * Never apologises and never implies the user did something wrong. Terminology
 * is bound by ux-guidelines.md §6: `לידים`, never `לקוח`.
 *
 * Server Component. Temporary by construction — each phase deletes its own entry
 * here as the real screen lands (Leads → Phase 3).
 */
export default function MobileSectionHandoff({
  icon,
  title,
  body,
  action,
  desktopHandoff = false,
}: {
  icon: IconNames
  title: string
  body: string
  /** A real, existing destination. Omitted only when none genuinely applies. */
  action?: { href: Route; label: string }
  /**
   * Offer the desktop handoff action (get this workspace's address onto the
   * computer). Set for a section that has no mobile screen AND no equivalent
   * mobile destination to send the user to instead — where "the full screen is
   * on the computer" is not a footnote but the entire answer.
   *
   * EXTENDED, NOT FORKED (architecture-rules.md §10): the desktop-only sections
   * needed one more affordance than the first caller (`MobileTodayEmpty`), so
   * this component grew a prop rather than gaining a near-duplicate sibling.
   * Default false keeps every existing caller byte-for-byte unchanged.
   */
  desktopHandoff?: boolean
}) {
  return (
    <div className='flex flex-col items-center gap-5 px-6 py-14 text-center'>
      <span className='flex size-14 items-center justify-center rounded-2xl bg-primary-tint'>
        <Icon name={icon} type='sol' className='size-6 bg-primary' />
      </span>

      <div className='max-w-[320px]'>
        <h2 className='text-lg font-bold leading-tight text-ink'>{title}</h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>{body}</p>
      </div>

      {action && (
        <Link
          href={action.href}
          className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {action.label}
        </Link>
      )}

      {desktopHandoff && <CopyDesktopLink />}

      <div className='flex w-full max-w-[320px] flex-col items-center gap-2'>
        <span aria-hidden='true' className='h-px w-full bg-gray-200' />
        <p className='text-[12px] text-gray-400'>
          המסך המלא זמין במחשב · <span dir='ltr'>{DESKTOP_URL_LABEL}</span>
        </p>
      </div>
    </div>
  )
}
