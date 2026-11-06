import type { ReactNode } from 'react'
import type { TodayBrief } from '@/lib/today/types'
import type { UiLocale } from '@/lib/i18n/config'
import { regionAttrs } from '@/lib/i18n/config'
import BriefHero from './BriefHero'
import BriefMission from './BriefMission'
import BriefList from './BriefList'
import BriefMeetings from './BriefMeetings'

// Presentational orchestrator (RSC). A pure function of the TodayBrief DTO — no
// data fetching, no logic, no clock. The service already decided everything.
// The analytics arrive as ready-made slots (streamed separately by the page), so
// the brief renders first and never waits on them.
//
//   Row 1  greeting + progress  |  next mission
//   Row 2  KPI cards, then trend chart | lead sources      (overview slot)
//   Row 3  leads to handle      |  funnel + today's meetings
type Props = { brief: TodayBrief; overview?: ReactNode; funnel?: ReactNode; locale?: UiLocale }

export default function TodayBriefView({ brief, overview, funnel, locale = 'he' }: Props) {
  const [mission, ...rest] = brief.items
  const hasMeetings = brief.meetings.length > 0
  return (
    // The dashboard is a translated region inside the (still Hebrew) workspace
    // <main>; for Hebrew this spreads nothing.
    <div className='mx-auto mb-8 flex w-full max-w-[1480px] flex-col gap-4 pt-4' {...regionAttrs(locale)}>
      <div className='flex flex-wrap items-stretch gap-4'>
        <BriefHero brief={brief} locale={locale} />
        {mission && <BriefMission item={mission} locale={locale} />}
      </div>

      {overview}

      <div className='flex flex-wrap items-start gap-4'>
        {rest.length > 0 && <BriefList items={rest} locale={locale} />}
        {(funnel || hasMeetings) && (
          <div className='flex min-w-0 flex-[1_1_300px] flex-col gap-4'>
            {funnel}
            {hasMeetings && <BriefMeetings meetings={brief.meetings} locale={locale} />}
          </div>
        )}
      </div>
    </div>
  )
}
