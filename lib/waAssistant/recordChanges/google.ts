import 'server-only'
import { classifyError } from '@/actions/calendar/shared'
import { markMeetingPatched, updateMeetingSyncState, type MeetingRow } from '@/db/meetings'
import { deleteEvent, updateEvent } from '@/lib/integrations/google/calendarClient'
import type { AgentScope } from '@/lib/agent/types'
import type { GoogleState } from '../meetings/copy'
import { googleCalendarConnected } from '../meetings/propose'

/**
 * Mirrors a verified change to Google, once and bounded in time. `sendUpdates`
 * is 'none': the owner approved a change to their own calendar, not a message
 * to the people invited. A failure only sets the row's sync state: the CRM
 * change already happened, and the reply says Google was not updated.
 */

const BUDGET_MS = 15_000

export type GoogleDeps = { updateEvent?: typeof updateEvent; deleteEvent?: typeof deleteEvent }

export async function mirrorMeetingChange(row: MeetingRow, scope: AgentScope, change: 'reschedule' | 'cancel', deps?: GoogleDeps): Promise<GoogleState> {
  const googleEventId = row.google_event_id
  if (!googleEventId || !(await googleCalendarConnected(scope.userId))) return 'not_connected'
  const run = async (): Promise<GoogleState> => {
    try {
      if (change === 'cancel') {
        await (deps?.deleteEvent ?? deleteEvent)({ userId: scope.userId, googleEventId, sendUpdates: 'none' })
      } else {
        const r = await (deps?.updateEvent ?? updateEvent)({
          userId: scope.userId,
          googleEventId,
          etag: null,
          startAt: new Date(row.start_at),
          endAt: new Date(row.end_at),
          timezone: row.timezone,
          sendUpdates: 'none',
        })
        await markMeetingPatched(row.id, scope.agencyId, r.etag)
      }
      return 'synced'
    } catch (err) {
      const { syncStatus, code } = classifyError(err)
      await updateMeetingSyncState(row.id, { status: syncStatus, syncError: `${change}:${code}` })
      return syncStatus
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const state = await Promise.race<GoogleState>([run().catch(() => 'failed' as const), new Promise((r) => (timer = setTimeout(() => r('unconfirmed'), BUDGET_MS)))])
  clearTimeout(timer)
  return state
}
