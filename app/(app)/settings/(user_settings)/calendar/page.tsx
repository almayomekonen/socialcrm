import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'
import CalendarConnect from '@/components/settings/CalendarConnect'

export const metadata: Metadata = { title: 'יומן Google' }

export default async function CalendarSettingsPage() {
  const user = await requireAgencyUser()
  const conn = await getCalendarConnectionByUserId(user.id)

  const state: 'not_connected' | 'connected' | 'reauth_required' = !conn
    ? 'not_connected'
    : conn.sync_status === 'reauth_required'
      ? 'reauth_required'
      : conn.sync_status === 'disabled'
        ? 'not_connected'
        : 'connected'

  return (
    <div>
      <h1 className='title'>יומן Google</h1>
      <div className='my-6 max-w-lg'>
        <CalendarConnect
          state={state}
          email={conn?.google_email ?? null}
          lastError={conn?.last_error ?? null}
        />
      </div>
    </div>
  )
}
