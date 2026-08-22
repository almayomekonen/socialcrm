'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
import { listUpcomingMeetings as dbListUpcomingMeetings } from '@/db/meetings'
import { toDate, toSummary, type MeetingSummaryDTO } from './shared'

/**
 * TIER 1 READ, and the reason /calendar used to break.
 *
 * The page itself only ever required an authenticated agency user, but it reads
 * its meetings through here. With the paid guard on this read, a lapsed
 * subscription threw ProductAccessError during the server render and the
 * segment error boundary answered with "חלה שגיאה במערכת" — the customer was
 * told the system had failed when their plan had simply ended, and their own
 * meetings became unreachable.
 *
 * Listing meetings the agency already owns spends nothing and reaches nothing
 * external. Creating, editing, rescheduling and cancelling keep the paid guard
 * in their own actions, which is where the boundary belongs.
 *
 * Identity and tenant scoping are unchanged: the query below is still scoped by
 * the session's agencyId and organizerUserId.
 */
export async function listUpcomingMeetings(input?: { limit?: number; fromAt?: string | Date }): Promise<MeetingSummaryDTO[]> {
  const user = await requireBasicCrmAccess()
  const fromAt = input?.fromAt ? toDate(input.fromAt) : new Date()
  const rows = await dbListUpcomingMeetings({
    agencyId: user.agencyId,
    organizerUserId: user.id,
    limit: input?.limit,
    fromAt: fromAt ?? new Date(),
  })
  return rows.map(toSummary)
}
