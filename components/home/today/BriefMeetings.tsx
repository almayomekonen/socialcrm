import Link from 'next/link'
import type { MeetingItem } from '@/lib/today/types'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { badgeOutline, btn } from '@/components/home/dashboard/ui'

// Presentational (RSC). The fixed shape of the day — a separate lane, never part
// of the "needs you" count (INV-14). One tab of the dashboard's tabbed section,
// in the same bordered panel as the leads table. The time label is precomputed by
// the service in the business timezone; a meeting without one renders its title only.

export default function BriefMeetings({ meetings, locale = 'he' }: { meetings: MeetingItem[]; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='overflow-hidden rounded-lg border border-neutral-200 bg-white'>
      {/* The tab label names the section; the strip only carries the way out. */}
      <div className='flex items-center justify-end gap-3 border-b border-neutral-200 bg-neutral-100 px-4 py-1.5'>
        <Link href='/calendar' className={`${btn.base} ${btn.ghost} h-7 px-2 text-sm`}>
          {t('today.meetings.calendar')}
        </Link>
      </div>
      <ul>
        {meetings.map((m) => (
          <li key={m.id} className='flex items-center gap-3 border-b border-neutral-200 px-4 py-3 last:border-0'>
            {m.timeLabel && <span className={`${badgeOutline} min-w-14 tabular-nums`}>{m.timeLabel}</span>}
            <span className='min-w-0'>
              <span className='block truncate text-sm font-medium text-neutral-950'>{m.title || t('today.meetings.untitled')}</span>
              {m.subtitle && <span className='block truncate text-sm text-neutral-500'>{m.subtitle}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
