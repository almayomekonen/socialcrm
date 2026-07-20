import type { TodayBrief } from '@/lib/today/types'
import BriefHero from './BriefHero'
import BriefMission from './BriefMission'
import BriefList from './BriefList'
import BriefMeetings from './BriefMeetings'

// Presentational orchestrator (RSC). A pure function of the TodayBrief DTO — no
// data fetching, no logic, no clock. The service already decided everything.
export default function TodayBriefView({ brief }: { brief: TodayBrief }) {
  const [mission, ...rest] = brief.items
  return (
    <div className='mb-8 grid gap-4'>
      <BriefHero brief={brief} />
      {mission && <BriefMission item={mission} />}
      {rest.length > 0 && <BriefList items={rest} />}
      {brief.meetings.length > 0 && <BriefMeetings meetings={brief.meetings} />}
    </div>
  )
}
