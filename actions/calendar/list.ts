'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { listUpcomingMeetings as dbListUpcomingMeetings } from '@/db/meetings'
import { toDate, toSummary, type MeetingSummaryDTO } from './shared'

export async function listUpcomingMeetings(input?: { limit?: number; fromAt?: string | Date }): Promise<MeetingSummaryDTO[]> {
  const user = await requireProductAccess()
  const fromAt = input?.fromAt ? toDate(input.fromAt) : new Date()
  const rows = await dbListUpcomingMeetings({
    agencyId: user.agencyId,
    organizerUserId: user.id,
    limit: input?.limit,
    fromAt: fromAt ?? new Date(),
  })
  return rows.map(toSummary)
}
