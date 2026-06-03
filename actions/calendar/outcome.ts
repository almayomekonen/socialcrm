'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import {
  getMeeting,
  markMeetingCompleted as dbMarkMeetingCompleted,
  markMeetingNoShow as dbMarkMeetingNoShow,
} from '@/db/meetings'
import { getFullLead } from '@/db/clients'
import {
  suggestNextLeadStatus,
  type SuggestedLeadStatus,
} from '@/lib/calendar/outcomeStatusSuggestion'

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

// Stage 3 widening: when the action succeeds AND the meeting has a linked
// lead, we compute a suggestedLeadStatus per lib/calendar/outcomeStatusSuggestion.
// Null when there's no lead, the lead is at a terminal status, or the
// outcome is no_show (which never nudges). The hook surfaces this as an
// in-dialog banner; the rep dismisses or applies with one click.
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

// Resolves the suggested next lead status for a meeting that just transitioned
// into a terminal outcome. Best-effort: if the lead fetch fails for any reason
// (deleted, permission issue, transient DB error) we return null rather than
// blocking the outcome. The outcome write has ALREADY committed by the time
// we get here — the nudge is decoration, not the primary write.
async function resolveSuggestion(
  outcome: 'completed' | 'no_show',
  leadId: number | null,
): Promise<SuggestedLeadStatus | null> {
  if (!leadId) return null
  try {
    const lead = await getFullLead({ id: leadId, select: ['status'] })
    return suggestNextLeadStatus(outcome, lead?.status ?? null)
  } catch (err) {
    // Observability: a degraded fetch silently suppresses every nudge.
    // Without this log a getFullLead outage would be invisible from the
    // outside (outcome marks still succeed, just no banners). Matches the
    // console.warn cadence in the hook.
    console.warn('[calendar.outcome.suggest] getFullLead failed', err)
    return null
  }
}

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
      leadId: meeting.lead_id,
      suggestedLeadStatus: await resolveSuggestion('completed', meeting.lead_id),
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
    leadId: meeting.lead_id,
    suggestedLeadStatus: await resolveSuggestion('completed', meeting.lead_id),
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
      leadId: meeting.lead_id,
      // no_show never nudges — suggestion will be null. Included for
      // consistency with the discriminated union.
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
