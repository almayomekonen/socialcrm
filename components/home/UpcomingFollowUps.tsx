import Link from 'next/link'
import { formatDate } from '@/lib/dates'
import FollowUpControl from '@/components/leads/FollowUpControl'
import { splitUpcoming, type UpcomingFollowUp } from '@/lib/leads/upcomingFollowUps'

/**
 * "מעקבים קרובים" — the upcoming (not-yet-due) follow-ups the user already
 * scheduled. A calm review surface: no urgency signals, no SLA badges, no
 * next-action. Reuses the dashboard Card container styling and the Stage 3
 * FollowUpControl (reschedule/clear in place). Always rendered so users can
 * trust their plan is visible.
 */
export default function UpcomingFollowUps({ rows, limit = 10 }: { rows: UpcomingFollowUp[]; limit?: number }) {
  const { visible, hasMore } = splitUpcoming(rows, limit)

  return (
    <div className='px-1 mt-2'>
      <h2 className='text-xs font-medium text-gray-400 mb-2'>מעקבים קרובים · מתוכננים, עוד לא הגיע זמנם</h2>

      {visible.length === 0 ? (
        <p className='text-xs text-gray-400 py-2'>אין מעקבים מתוכננים. כשתקבעו מעקב על ליד, הוא יופיע כאן.</p>
      ) : (
        <ul className='divide-y divide-gray-100'>
          {visible.map((r) => (
            <li key={r.id} className='py-1.5 flex items-center justify-between gap-3'>
              <div className='min-w-0'>
                <Link href={`/clients/${r.id}/summary`} className='text-sm text-gray-600 truncate hover:underline'>
                  {r.name || '—'}
                </Link>
                <p className='text-xs text-gray-400 truncate tabular-nums'>
                  {formatDate(r.nextFollowUpAt)}
                  {r.followUpNote ? ` · ${r.followUpNote}` : ''}
                </p>
              </div>
              <FollowUpControl leadId={r.id} current={r.nextFollowUpAt} compact />
            </li>
          ))}
        </ul>
      )}

      {hasMore && <p className='text-xs text-gray-400 mt-2'>מוצגים המעקבים הקרובים ביותר</p>}
    </div>
  )
}
