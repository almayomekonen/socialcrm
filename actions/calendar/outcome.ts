'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import {
  getMeeting,
  markMeetingCompleted as dbMarkMeetingCompleted,
  markMeetingNoShow as dbMarkMeetingNoShow,
} from '@/db/meetings'

// Discrete terminal-state reasons let the UI map each conflict to specific
// Hebrew copy. 'already_in_outcome' (the previous coarse reason) is replaced
// by three states so a future toast can say e.g. "הפגישה כבר בוטלה" instead
// of a generic failure. Once a meeting is in any terminal outcome
// (cancelled / completed / no_show), transitions between them require an
// explicit undo action — preserves audit trail and prevents
// double-stamping completed_at + no_show_at on the same row.
export type MarkOutcomeError =
  | 'invalid_input'
  | 'not_found'
  | 'not_owner'
  | 'already_cancelled'
  | 'already_completed'
  | 'already_no_show'

export type MarkMeetingCompletedResult =
  | { ok: true; meetingId: number; completedAt: string }
  | { ok: false; reason: MarkOutcomeError }

export type MarkMeetingNoShowResult =
  | { ok: true; meetingId: number; noShowAt: string }
  | { ok: false; reason: MarkOutcomeError }

export async function markMeetingCompleted(input: {
  meetingId: number | string
}): Promise<MarkMeetingCompletedResult> {
  const meetingId = Number(input.meetingId)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }

  const user = await requireAgencyUser()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }

  // Idempotent: already at target outcome → return existing timestamp.
  if (meeting.status === 'completed' && meeting.completed_at) {
    return {
      ok: true,
      meetingId,
      completedAt: meeting.completed_at.toISOString(),
    }
  }
  // Terminal-state guards. Any non-target terminal state rejects the
  // transition; the rep must undo (Stage 2+) to move between outcomes.
  if (meeting.status === 'cancelled') {
    return { ok: false, reason: 'already_cancelled' }
  }
  if (meeting.status === 'no_show') {
    return { ok: false, reason: 'already_no_show' }
  }

  const completedAt = new Date()
  await dbMarkMeetingCompleted(meetingId, user.agencyId)

  revalidatePath('/calendar')
  revalidatePath('/dashboard')
  if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)

  return {
    ok: true,
    meetingId,
    completedAt: completedAt.toISOString(),
  }
}

export async function markMeetingNoShow(input: {
  meetingId: number | string
}): Promise<MarkMeetingNoShowResult> {
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

  revalidatePath('/calendar')
  revalidatePath('/dashboard')
  if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)

  return {
    ok: true,
    meetingId,
    noShowAt: noShowAt.toISOString(),
  }
}
