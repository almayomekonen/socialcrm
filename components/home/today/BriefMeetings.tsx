import Icon from '@/lib/Icon'
import type { MeetingItem } from '@/lib/today/types'

// Presentational (RSC). The fixed shape of the day — a separate lane, never part
// of the "needs you" count (INV-14).
export default function BriefMeetings({ meetings }: { meetings: MeetingItem[] }) {
  return (
    <div className='overflow-hidden rounded-xl border border-border bg-surface'>
      <p className='px-4 pt-3.5 pb-1 text-sm font-semibold text-gray-700'>פגישות היום</p>
      <ul className='divide-y divide-gray-100'>
        {meetings.map((m) => (
          <li key={m.id} className='flex items-center gap-2.5 px-4 py-2.5'>
            <Icon name='calendar-day' className='size-4 bg-gray-400' />
            <span className='truncate text-sm text-gray-800'>{m.title || 'פגישה'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
