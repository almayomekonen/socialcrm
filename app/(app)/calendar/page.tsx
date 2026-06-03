import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'
import { listUpcomingMeetings } from '@/actions/calendar'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import CalendarView from '@/components/calendar/CalendarView'

export const metadata: Metadata = { title: 'פגישות' }

export default async function CalendarPage() {
  const user = await requireAgencyUser()
  const conn = await getCalendarConnectionByUserId(user.id)

  // Per ux-guidelines §11: render exactly one state at a time. If the user
  // has not connected, the only job is to drive them to the settings page;
  // the meetings list is not rendered at all.
  if (!conn || conn.sync_status === 'disabled') {
    return (
      <div className='p-5'>
        <h1 className='title'>פגישות</h1>
        <NotConnectedState />
      </div>
    )
  }

  // Show all of today's meetings (including ones that already ended a few
  // hours ago) plus everything future. Without the start-of-day anchor, a
  // meeting created at 14:00 disappears at 14:01 — confusing right after
  // create. Server-side `new Date()` returns UTC instant; rounding to the
  // *day boundary* lets local-time renders still show today's events even
  // when server timezone differs from the user's.
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const meetings = await listUpcomingMeetings({ limit: 100, fromAt: todayStart })
  const needsReauth = conn.sync_status === 'reauth_required'

  return (
    <div className='p-5'>
      <CalendarView meetings={meetings} needsReauth={needsReauth} />
    </div>
  )
}

function NotConnectedState() {
  return (
    <div className='mt-6 max-w-lg rounded-lg border border-gray-200 bg-white p-8 grid gap-4 text-center'>
      <Icon name='calendar' className='size-12 bg-gray-400 mx-auto' />
      <div className='grid gap-1'>
        <h2 className='text-xl font-bold'>חבר את היומן שלך</h2>
        <p className='text-gray-600 text-sm leading-relaxed'>
          חבר את חשבון Google שלך כדי לנהל פגישות עם לידים, ליצור קישורי Meet אוטומטית
          ולסנכרן ליומן Google.
        </p>
      </div>
      <div className='flex justify-center'>
        <Btn lbl='לחיבור היומן' href='/settings/calendar' />
      </div>
    </div>
  )
}
