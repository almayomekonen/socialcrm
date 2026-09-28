import { db } from '@/config/db'
import { insertMeeting } from '@/db/meetings'
import { emitAppointmentBooked } from '@/actions/calendar/shared'

/**
 * System / server meeting creation — NO product-session authorization.
 *
 * The third of the same pattern, after `createSystemTask` and
 * `setLeadFollowUpSystem`, and for the same reason: the user-facing boundary
 * (`actions/calendar/create.ts`) calls `requireProductAccess()` and re-derives
 * identity from the request cookie, while the Agent has already resolved
 * authority. Re-deriving it inside an executor would mean the actor that was
 * authorised and the actor that writes could differ.
 *
 * IT KEEPS THE AUTOMATION EMIT, and that is the part worth being deliberate
 * about. `emitAppointmentBooked` is what tells the Customer Automation Engine an
 * appointment exists, and the product's own comment is emphatic that the
 * occurrence is true the moment the ROW exists — no calendar provider is in that
 * path. Dropping it here would mean a meeting the agent booked silently never
 * reminds the lead, while an identical meeting booked by hand does. That is the
 * kind of divergence nobody discovers until a customer misses an appointment.
 *
 * IT DELIBERATELY DOES NOT PUSH TO GOOGLE. `pushMeetingToGoogle` is network I/O
 * against a third party, inside an executor that runs under the agent's
 * wall-clock deadline, and mirroring to a calendar provider is not what this
 * phase is. The row is therefore left at `sync_status: 'pending'` — an existing,
 * already-modelled state with an existing user-triggered retry
 * (`actions/calendar/retry.ts`). The meeting is real in the CRM; it is simply
 * not mirrored yet, and nothing pretends otherwise.
 */
export async function createMeetingSystem({
  agencyId,
  organizerUserId,
  leadId,
  title,
  description,
  timezone,
  startAt,
  endAt,
}: {
  /** Authenticated agency. Never a caller or model value. */
  agencyId: number
  /** Authenticated actor — the meeting's organizer. */
  organizerUserId: number
  leadId: number
  title: string
  description: string | null
  /** IANA zone the wall-clock time was expressed in. */
  timezone: string
  startAt: Date
  endAt: Date
  // Discriminated on `ok`, matching `actions/calendar/create.ts`'s own result
  // shape — and the form that narrows without strictNullChecks.
}): Promise<{ ok: true; meetingId: number } | { ok: false; reason: 'lead_not_found' }> {
  /**
   * The lead must resolve, IN THIS AGENCY, before anything is written.
   *
   * Deliberately NOT `getFullLead`, which the product's own action uses: that
   * helper calls `requireUser()` and re-derives the agency from the request
   * cookie, so on a session-less path it finds nothing and every meeting would
   * fail as `lead_not_found`. The agency is already resolved here and is used
   * directly — the third time this same trap has appeared, after
   * `createSystemTask` and `setLeadFollowUpSystem`.
   *
   * The caller's permission check is what decides WHETHER this actor may touch
   * the lead; this check only establishes that the lead exists and belongs to
   * the agency, so a bad id returns a clean result instead of an FK violation.
   */
  const lead = await db('clients').where({ id: leadId, agencyId }).first('id')
  if (!lead) return { ok: false, reason: 'lead_not_found' }

  const meetingId = await insertMeeting({
    agencyId,
    organizerUserId,
    leadId,
    title: title.slice(0, 255),
    description: description?.slice(0, 5000) ?? null,
    location: null,
    timezone,
    startAt,
    endAt,
  })

  // Before any mirroring concern, exactly as the product action does: the
  // occurrence is true because the row exists.
  await emitAppointmentBooked({ agencyId, meetingId, leadId, startAt, title: title.slice(0, 255) })

  return { ok: true, meetingId }
}
