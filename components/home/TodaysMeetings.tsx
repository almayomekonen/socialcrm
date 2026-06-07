'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { markMeetingCompleted, markMeetingNoShow } from '@/actions/calendar'
import type { TodaysMeeting } from '@/db/meetings'

/**
 * Dashboard V2 — today's meetings strip. Compact awareness + the two outcome
 * actions, reusing the existing meeting-outcome server actions directly (the
 * status-suggestion nudge is the dialog's job; here we just record + refresh,
 * so a marked meeting drops off the strip = completion feedback).
 */

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

export default function TodaysMeetings({ meetings }: { meetings: TodaysMeeting[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  if (!meetings.length) return null

  function mark(id: number, kind: 'completed' | 'no_show') {
    startTransition(async () => {
      const res = kind === 'completed' ? await markMeetingCompleted({ meetingId: id }) : await markMeetingNoShow({ meetingId: id })
      if (res.ok) {
        toast('success', kind === 'completed' ? 'סומן כהושלמה' : 'סומן כלא הגיע')
        router.refresh()
      } else {
        toast('error', 'עדכון הפגישה נכשל')
      }
    })
  }

  return (
    <div className='px-1'>
      <h2 className='text-xs font-medium tracking-wide text-gray-500 mb-2'>פגישות היום</h2>
      <ul className='divide-y divide-gray-100'>
        {meetings.map((m) => (
          <li key={m.id} className='py-1.5 flex items-center justify-between gap-3'>
            <div className='min-w-0 flex items-center gap-2'>
              <span className='text-sm font-medium tabular-nums shrink-0'>{timeLabel(m.startAt)}</span>
              <span className='text-sm text-gray-700 truncate'>
                {m.leadId && m.leadName ? (
                  <Link href={`/clients/${m.leadId}/summary`} className='underline'>
                    {m.leadName}
                  </Link>
                ) : (
                  m.title
                )}
              </span>
            </div>
            <div className='flex gap-1 shrink-0'>
              {m.meetUrl && (
                <a
                  href={m.meetUrl}
                  target='_blank'
                  rel='noreferrer'
                  className='inline-flex items-center h-9 px-3 rounded-md bg-gray-200 hover:bg-gray-300 text-sm font-medium'
                >
                  הצטרף
                </a>
              )}
              <Btn variant='outline' size='small' lbl='הושלמה' onClick={() => mark(m.id, 'completed')} disabled={pending} />
              <Btn variant='ghost' size='small' lbl='לא הגיע' onClick={() => mark(m.id, 'no_show')} disabled={pending} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
