'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import {
  getMeeting,
  markMeetingCompleted as dbMarkMeetingCompleted,
  markMeetingNoShow as dbMarkMeetingNoShow,
} from '@/db/meetings'
import { getFullLead, recordLeadActivity } from '@/db/clients'
import { suggestNextLeadStatus, type SuggestedLeadStatus } from '@/lib/calendar/outcomeStatusSuggestion'

export type MarkOutcomeError =
  | 'invalid_input'
  | 'not_found'
  | 'not_owner'
  | 'already_cancelled'
  | 'already_completed'
  | 'already_no_show'

export type MarkMeetingCompletedResult =
  | {
      ok: true
      meetingId: number
      completedAt: string
      leadId: number | null
      suggestedLeadStatus: SuggestedLeadStatus | null
    }
  | { ok: false; reason: MarkOutcomeError }

export type MarkMeetingNoShowResult =
  | {
      ok: true
      meetingId: number
      noShowAt: string
      leadId: number | null
      suggestedLeadStatus: SuggestedLeadStatus | null
    }
  | { ok: false; reason: MarkOutcomeError }

async function resolveSuggestion(outcome: 'completed' | 'no_show', leadId: number | null): Promise<SuggestedLeadStatus | null> {
  if (!leadId) return null
  try {
    const lead = await getFullLead({ id: leadId, select: ['status'] })
    return suggestNextLeadStatus(outcome, lead?.status ?? null)
  } catch (err) {
    console.warn('[calendar.outcome.suggest] getFullLead failed', err)
    return null
  }
}

export async function markMeetingCompleted(input: { meetingId: number | string }): Promise<MarkMeetingCompletedResult> {
  const meetingId = Number(input.meetingId)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }

  const user = await requireAgencyUser()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }

  if (meeting.status === 'completed' && meeting.completed_at) {
    return {
      ok: true,
      meetingId,
      completedAt: meeting.completed_at.toISOString(),
      leadId: meeting.lead_id,
      suggestedLeadStatus: await resolveSuggestion('completed', meeting.lead_id),
    }
  }
  if (meeting.status === 'cancelled') {
    return { ok: false, reason: 'already_cancelled' }
  }
  if (meeting.status === 'no_show') {
    return { ok: false, reason: 'already_no_show' }
  }

  const completedAt = new Date()
  await dbMarkMeetingCompleted(meetingId, user.agencyId)

  if (meeting.lead_id) {
    try {
      await recordLeadActivity(meeting.lead_id, user.agencyId, { outcomeType: 'meeting_completed', at: completedAt })
    } catch (err) {
      console.warn('[calendar.outcome] lead activity stamp failed (completed)', err)
    }
  }

  revalidatePath('/calendar')
  revalidatePath('/dashboard')
  if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)

  return {
    ok: true,
    meetingId,
    completedAt: completedAt.toISOString(),
    leadId: meeting.lead_id,
    suggestedLeadStatus: await resolveSuggestion('completed', meeting.lead_id),
  }
}

export async function markMeetingNoShow(input: { meetingId: number | string }): Promise<MarkMeetingNoShowResult> {
  const meetingId = Number(input.meetingId)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }

  const user = await requireAgencyUser()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }

  if (meeting.status === 'no_show' && meeting.no_show_at) {
    return {
      ok: true,
      meetingId,
      noShowAt: meeting.no_show_at.toISOString(),
      leadId: meeting.lead_id,
      suggestedLeadStatus: null,
    }
  }
  if (meeting.status === 'cancelled') {
    return { ok: false, reason: 'already_cancelled' }
  }
  if (meeting.status === 'completed') {
    return { ok: false, reason: 'already_completed' }
  }

  const noShowAt = new Date()
  await dbMarkMeetingNoShow(meetingId, user.agencyId)

  if (meeting.lead_id) {
    try {
      await recordLeadActivity(meeting.lead_id, user.agencyId, { outcomeType: 'meeting_no_show', at: noShowAt })
    } catch (err) {
      console.warn('[calendar.outcome] lead activity stamp failed (no_show)', err)
    }
  }

  revalidatePath('/calendar')
  revalidatePath('/dashboard')
  if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)

  return {
    ok: true,
    meetingId,
    noShowAt: noShowAt.toISOString(),
    leadId: meeting.lead_id,
    suggestedLeadStatus: null,
  }
}
