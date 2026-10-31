import Link from 'next/link'
import Icon from '@/lib/Icon'
import { CATEGORY_ICON } from '@/modules/notifications/dropdown'
import { CENTER_CATEGORY_ORDER, centerHref, type CenterFilters } from '@/modules/notifications/center'
import { categoryLabelIn } from '@/modules/notifications/display'
import { LEGACY_DEFAULT_LOCALE, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The center's filters — links, not buttons, and therefore not state.
 *
 * Same chip pattern as `InboxChannelSwitch`, down to the `aria-current='page'`:
 * the filter is in the URL, so the back button works, a filtered view can be
 * shared, and the server can run the query for it. A client-side filter would
 * have needed its own state and its own fetch to do less.
 *
 * Two independent axes, deliberately kept separate rather than merged into one
 * row of mutually exclusive chips: "unread" answers a different question than
 * "leads", and a user working through unread leads wants both at once.
 *
 * Labels in `locale` (the page's interface language; Hebrew by default). The
 * hrefs — and so the filters themselves — are the same in every language.
 */
export default function NotificationFilters({
  filters,
  locale = LEGACY_DEFAULT_LOCALE,
}: {
  filters: CenterFilters
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <div className='flex flex-wrap items-center gap-3'>
      <nav aria-label={t('notifications.filters.readState')} className='flex flex-wrap items-center gap-1.5'>
        <Chip href={centerHref({ ...filters, unreadOnly: false })} active={!filters.unreadOnly} label={t('notifications.filters.all')} />
        <Chip href={centerHref({ ...filters, unreadOnly: true })} active={filters.unreadOnly} label={t('notifications.filters.unread')} />
      </nav>

      <nav aria-label={t('notifications.filters.category')} className='flex flex-wrap items-center gap-1.5'>
        <Chip
          href={centerHref({ ...filters, category: null })}
          active={filters.category === null}
          label={t('notifications.filters.allTypes')}
        />
        {CENTER_CATEGORY_ORDER.map((category) => (
          <Chip
            key={category}
            href={centerHref({ ...filters, category })}
            active={filters.category === category}
            label={categoryLabelIn(category, locale)}
            icon={CATEGORY_ICON[category]}
          />
        ))}
      </nav>
    </div>
  )
}

function Chip({
  href,
  active,
  label,
  icon,
}: {
  href: string
  active: boolean
  label: string
  icon?: (typeof CATEGORY_ICON)[keyof typeof CATEGORY_ICON]
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? 'border-info-border bg-primary-tint text-primary-text font-medium'
          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
      }`}
    >
      {icon && <Icon name={icon} type='sol' className={`size-3.5 ${active ? 'bg-primary' : 'bg-gray-400'}`} />}
      {label}
    </Link>
  )
}
