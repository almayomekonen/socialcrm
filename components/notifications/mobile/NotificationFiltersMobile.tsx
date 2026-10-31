import Link from 'next/link'
import { centerHref, type CenterFilters } from '@/modules/notifications/center'
import { categoryLabelIn } from '@/modules/notifications/display'
import { LEGACY_DEFAULT_LOCALE, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

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
 *
 * Labelled by category CODE in `locale` (Hebrew: "הכל" / `CATEGORY_LABEL`).
 */

const SEGMENTS: CenterFilters['category'][] = [null, 'leads', 'followups']

export default function NotificationFiltersMobile({
  filters,
  locale = LEGACY_DEFAULT_LOCALE,
}: {
  filters: CenterFilters
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <div
      role='navigation'
      aria-label={t('notifications.filters.mobileLabel')}
      className='flex items-stretch overflow-hidden rounded-md border border-gray-200 bg-white'
    >
      {SEGMENTS.map((category) => {
        const active = filters.category === category
        return (
          <Link
            key={category ?? 'all'}
            href={centerHref({ ...filters, category })}
            aria-current={active ? 'page' : undefined}
            className={`press flex min-h-11 flex-1 items-center justify-center border-s border-gray-200 text-[13px] font-medium first:border-s-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
              active ? 'bg-primary-tint text-primary-text' : 'bg-white text-gray-500'
            }`}
          >
            {category ? categoryLabelIn(category, locale) : t('notifications.filters.all')}
          </Link>
        )
      })}
    </div>
  )
}
