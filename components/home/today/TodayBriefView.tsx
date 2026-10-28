import type { TodayBrief } from '@/lib/today/types'
import BriefHero from './BriefHero'
import BriefMission from './BriefMission'
import BriefList from './BriefList'
import BriefMeetings from './BriefMeetings'

// Presentational orchestrator (RSC). A pure function of the TodayBrief DTO — no
// data fetching, no logic, no clock. The service already decided everything.
// Two wrapping rows: situation + next action, then the rest of the brief + the
// day's fixed meetings. A row whose blocks are all empty is not rendered.
export default function TodayBriefView({ brief }: { brief: TodayBrief }) {
  const [mission, ...rest] = brief.items
  const hasMeetings = brief.meetings.length > 0
  return (
    <div className='mx-auto mb-8 flex w-full max-w-[1280px] flex-col gap-5'>
      <div className='flex flex-wrap items-stretch gap-5'>
        <BriefHero brief={brief} />
        {mission && <BriefMission item={mission} />}
      </div>
      {(rest.length > 0 || hasMeetings) && (
        <div className='flex flex-wrap items-start gap-5'>
          {rest.length > 0 && <BriefList items={rest} />}
          {hasMeetings && <BriefMeetings meetings={brief.meetings} />}
        </div>
      )}
    </div>
  )
}
