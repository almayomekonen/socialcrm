import {
  updateMeetingSyncState,
  type MeetingRow,
} from '@/db/meetings'
import {
  createEvent,
  CalendarApiError,
} from '@/lib/integrations/google/calendarClient'
import { CalendarAuthError } from '@/lib/integrations/google/calendarTokens'

export const INVITE_DIAG = process.env.CALENDAR_INVITE_DIAG === '1'

export type MeetingSummaryDTO = {
  id: number
  leadId: number | null
  title: string
  location: string | null
  timezone: string
  startAt: string
  endAt: string
  status: 'scheduled' | 'cancelled' | 'completed' | 'no_show'
  meetUrl: string | null
  syncStatus: 'pending' | 'synced' | 'failed' | 'reauth_required'
  syncError: string | null
  // Stage 2: outcome timestamps surfaced so the calendar grid and details
  // dialog can render "הושלמה ב-DD/MM" / "לא הגיע ב-DD/MM" badges without an
  // extra round-trip. Null when meeting hasn't been marked.
  completedAt: string | null
  noShowAt: string | null
}

export type ActionError = 'invalid_input' | 'lead_not_found' | 'not_found' | 'not_owner' | 'already_synced'

export type PushOutcome = {
  meetUrl: string | null
  syncStatus: 'synced' | 'failed' | 'reauth_required'
}

export async function pushMeetingToGoogle(input: {
  meetingId: number
  userId: number
  title: string
  description: string | null
  location: string | null
  startAt: Date
  endAt: Date
  timezone: string
  attendees: Array<{ email: string; displayName: string | null }>
}): Promise<PushOutcome> {
  try {
    const result = await createEvent({
      userId: input.userId,
      meetingId: input.meetingId,
      title: input.title,
      description: input.description,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      attendees: input.attendees,
    })
    await updateMeetingSyncState(input.meetingId, {
      status: 'synced',
      googleEventId: result.googleEventId,
      googleIcalUid: result.googleIcalUid,
      meetUrl: result.meetLink,
      etag: result.etag,
    })
    return { meetUrl: result.meetLink, syncStatus: 'synced' }
  } catch (err) {
    const { syncStatus, code } = classifyError(err)
    await updateMeetingSyncState(input.meetingId, {
      status: syncStatus,
      syncError: `push:${code}`,
    })
    if (!(err instanceof CalendarAuthError) && !(err instanceof CalendarApiError)) {
      console.warn('[calendar.push] unexpected error', {
        meetingId: input.meetingId,
        error: (err as Error)?.message,
      })
    }
    return { meetUrl: null, syncStatus }
  }
}

export function classifyError(err: unknown): {
  syncStatus: 'failed' | 'reauth_required'
  code: string
} {
  if (err instanceof CalendarAuthError) {
    const isReauth = err.reason === 'reauth_required' || err.reason === 'missing_scope' || err.reason === 'not_connected'
    return { syncStatus: isReauth ? 'reauth_required' : 'failed', code: `auth:${err.reason}` }
  }
  if (err instanceof CalendarApiError) {
    const isReauth = err.reason === 'reauth_required' || err.reason === 'missing_scope'
    return {
      syncStatus: isReauth ? 'reauth_required' : 'failed',
      code: `api:${err.reason}:${err.status}`,
    }
  }
  return { syncStatus: 'failed', code: `unknown:${(err as Error)?.message?.slice(0, 100) ?? ''}` }
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,255}$/

export function normalizeAttendees(
  raw: Array<{ email: string; displayName?: string | null }>,
): Array<{ email: string; displayName: string | null }> {
  const seen = new Set<string>()
  const out: Array<{ email: string; displayName: string | null }> = []
  for (const a of raw) {
    const email = a.email?.trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue
    seen.add(email)
    out.push({ email, displayName: a.displayName ?? null })
  }
  return out
}

export function toDate(value: string | Date | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

export function toSummary(row: MeetingRow): MeetingSummaryDTO {
  return {
    id: row.id,
    leadId: row.lead_id,
    title: row.title,
    location: row.location,
    timezone: row.timezone,
    startAt: row.start_at instanceof Date ? row.start_at.toISOString() : String(row.start_at),
    endAt: row.end_at instanceof Date ? row.end_at.toISOString() : String(row.end_at),
    status: row.status,
    meetUrl: row.meet_url,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : null,
    noShowAt: row.no_show_at instanceof Date ? row.no_show_at.toISOString() : null,
  }
}
