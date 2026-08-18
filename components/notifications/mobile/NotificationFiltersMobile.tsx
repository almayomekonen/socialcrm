import Link from 'next/link'
import { centerHref, type CenterFilters } from '@/modules/notifications/center'

/**
 * The notification filter, for a phone: one segmented control, three choices.
 *
 * WHAT IT REPLACED. The desktop filter is two wrapping `<nav>` groups holding
 * seven chips across two independent axes — read-state and category. Measured on
 * a phone it wrapped into a ragged two-row block of 26px chips that took more
 * vertical space than the first notification and read as the busiest thing on
 * the screen. A filter should be quieter than the thing it filters.
 *
 * THREE SEGMENTS, because an owner opening this screen is triaging, not
 * querying: everything, the people, or the work that is due. Those map exactly
 * onto the categories the feed already has, so this is a different CONTROL over
 * the same state — same `centerHref`, same URL params, same server query. No new
 * filter architecture and no new backend.
 *
 * DELIBERATE SCOPE REDUCTION: the unread toggle and the שיחות / זמני תגובה /
 * חיבורים categories are not offered here. Their URLs still work and the server
 * still honours them; they are simply not surfaced on a phone. That is a product
 * decision to keep the control to three thumb-sized targets rather than seven
 * cramped ones — flagged in the report, not hidden.
 *
 * Links, not state: the filter lives in the URL, so back/forward work and a
 * filtered view can be shared — the same rule the desktop chips follow.
 */

const SEGMENTS: { label: string; category: CenterFilters['category'] }[] = [
  { label: 'הכל', category: null },
  { label: 'לידים', category: 'leads' },
  { label: 'מעקבים', category: 'followups' },
]

export default function NotificationFiltersMobile({ filters }: { filters: CenterFilters }) {
  return (
    <div
      role='navigation'
      aria-label='סינון התראות'
      /* One track, three cells. `p-1` gives the active pill room to sit inside
         the track instead of straddling its border. */
      className='flex items-center gap-1 rounded-lg bg-gray-100 p-1'
    >
      {SEGMENTS.map((s) => {
        const active = filters.category === s.category
        return (
          <Link
            key={s.label}
            href={centerHref({ ...filters, category: s.category })}
            aria-current={active ? 'page' : undefined}
            /* `min-h-11` (44px), not 40: measured, the shorter segment left all
               three under the touch minimum. */
            className={`press flex min-h-11 flex-1 items-center justify-center rounded-md text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              active ? 'bg-white text-ink shadow-sm' : 'text-gray-500'
            }`}
          >
            {s.label}
          </Link>
        )
      })}
    </div>
  )
}
