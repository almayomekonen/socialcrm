import Link from 'next/link'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default function QuickLinks({
  dueCount,
  newCount,
  upcomingCount,
  meetingsCount,
  locale = 'he',
}: {
  dueCount: number
  newCount: number
  upcomingCount: number
  meetingsCount: number
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const items = [
    { label: t('today.quickLinks.allFollowups'), count: dueCount, href: '/leads?view=due' },
    { label: t('today.quickLinks.newLeads'), count: newCount, href: '/leads' },
    { label: t('today.quickLinks.upcoming'), count: upcomingCount, href: '/leads' },
    { label: t('today.quickLinks.meetingsToday'), count: meetingsCount, href: '/calendar' },
  ]

  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          className='inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50'
        >
          <span className='text-gray-700'>{it.label}</span>
          <span className='font-medium tabular-nums text-gray-900'>{it.count}</span>
        </Link>
      ))}
    </div>
  )
}
