import type { ReactNode } from 'react'
import Link from 'next/link'
import type { TodayBrief } from '@/lib/today/types'
import type { UiLocale } from '@/lib/i18n/config'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import BriefHero from './BriefHero'
import BriefMission from './BriefMission'
import BriefList from './BriefList'
import BriefMeetings from './BriefMeetings'
import DashboardTabs, { type DashboardTab } from '@/components/home/dashboard/DashboardTabs'
import { btn } from '@/components/home/dashboard/ui'

// Presentational orchestrator (RSC). A pure function of the TodayBrief DTO — no
// data fetching, no logic, no clock. The service already decided everything.
// The analytics arrive as ready-made slots (streamed separately by the page), so
// the brief renders first and never waits on them. Layout follows the shadcn
// dashboard-01 example:
//
//   Row 1  greeting section card  |  next-mission section card
//   Row 2  KPI section cards, then the interactive area chart   (overview slot)
//   Row 3  tabs: leads to handle (table) · lead sources · funnel · meetings
type Props = {
  brief: TodayBrief
  overview?: ReactNode
  sources?: ReactNode
  funnel?: ReactNode
  locale?: UiLocale
}

export default function TodayBriefView({ brief, overview, sources, funnel, locale = 'he' }: Props) {
  const t = translatorFor(locale)
  const [mission, ...rest] = brief.items
  const candidates: (DashboardTab | false | undefined | null | 0 | '')[] = [
    rest.length > 0 && { id: 'leads', label: t('today.list.title'), count: rest.length, panel: <BriefList items={rest} locale={locale} /> },
    sources && { id: 'sources', label: t('today.analytics.sourcesTitle'), panel: sources },
    funnel && { id: 'funnel', label: t('today.analytics.funnelTitle'), panel: funnel },
    brief.meetings.length > 0 && {
      id: 'meetings',
      label: t('today.meetings.title'),
      count: brief.meetings.length,
      panel: <BriefMeetings meetings={brief.meetings} locale={locale} />,
    },
  ]
  const tabs = candidates.filter((x): x is DashboardTab => Boolean(x))

  return (
    // The dashboard is a translated region inside the (still Hebrew) workspace
    // <main>; for Hebrew this spreads nothing.
    <div className='mx-auto mb-8 flex w-full max-w-[1480px] flex-col gap-4 pt-4 md:gap-6' {...regionAttrs(locale)}>
      <div className={`grid grid-cols-1 gap-4 ${mission ? 'lg:grid-cols-2' : ''}`}>
        <BriefHero brief={brief} locale={locale} />
        {mission && <BriefMission item={mission} locale={locale} />}
      </div>

      {overview}

      <DashboardTabs
        label={t('today.title')}
        tabs={tabs}
        actions={
          <Link href='/leads' className={`${btn.base} ${btn.outline} ${btn.sm}`}>
            {t('today.list.allLeads')}
          </Link>
        }
      />
    </div>
  )
}
