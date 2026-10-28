import Link from 'next/link'
import type { MeetingItem } from '@/lib/today/types'

// Presentational (RSC). The fixed shape of the day — a separate lane, never part
// of the "needs you" count (INV-14). The time label is precomputed by the service
// in the business timezone; a meeting without one renders its title only.

export default function BriefMeetings({ meetings }: { meetings: MeetingItem[] }) {
  return (
    <section className='flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-2xl border border-border bg-surface px-[22px] py-5'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-lg font-bold text-ink'>פגישות היום</h2>
        <Link
          href='/calendar'
          className='text-sm font-semibold text-primary-text hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        >
          ליומן
        </Link>
      </div>
      <ul className='flex flex-col gap-3'>
        {meetings.map((m) => (
          <li key={m.id} className='flex items-center gap-3'>
            {m.timeLabel && (
              <span className='w-[54px] shrink-0 rounded-[10px] bg-primary-tint py-2 text-center text-[15px] font-bold text-primary-text tabular-nums'>
                {m.timeLabel}
              </span>
            )}
            <span className='min-w-0 truncate text-[15px] font-semibold text-ink'>{m.title || 'פגישה'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
