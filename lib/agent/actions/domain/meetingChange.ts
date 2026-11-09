import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { getMeeting, type MeetingRow } from '@/db/meetings'
import { rescheduleAppointmentReminders } from '@/actions/calendar/shared'
import { businessInstantMs } from '@/lib/today/time'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationCheck, VerificationResult } from '../types'

/**
 * `reschedule_meeting` and `cancel_meeting`: changes to an appointment that
 * already exists.
 *
 * As in the calendar's own actions (actions/calendar/update.ts, cancel.ts), only
 * the organizer may change a meeting, and a meeting with a recorded outcome
 * cannot be cancelled. Those actions read identity from the request cookie, so
 * these are their session-less counterparts with the same rules.
 *
 * The CRM row is the source of truth and is written here. Google is mirrored
 * afterwards, once the change is verified (lib/waAssistant/recordChanges/google.ts).
 *
 * The write is conditional on the state the owner saw on the card, so a meeting
 * moved after the card was sent is reported rather than overwritten. Sending
 * nothing to the attendees is what keeps this LOW_RISK_WRITE.
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ids = { meetingId: z.number().int().positive(), clientId: z.number().int().positive() }

const rescheduleArgs = z.object({
  ...ids,
  fromStartAt: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(TIME_RE),
  durationMinutes: z.number().int().min(5).max(1440),
})
const cancelArgs = z.object(ids)

/** The meeting, if this actor may change it. */
async function ownMeeting(ctx: ExecuteContext, meetingId: number, clientId: number): Promise<MeetingRow | null> {
  const m = await getMeeting(meetingId, ctx.actor.agencyId)
  return m && Number(m.lead_id) === clientId && Number(m.organizer_user_id) === ctx.actor.userId ? m : null
}

const done = (id: number): ExecutionResult => ({ status: 'SUCCESS', targetIds: [{ kind: 'meeting', id: String(id) }] })
const startMsOf = (a: z.infer<typeof rescheduleArgs>) => businessInstantMs(a.date, a.startTime)

async function executeReschedule(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = rescheduleArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const a = parsed.data
  const startMs = startMsOf(a)
  const from = new Date(a.fromStartAt)
  if (!Number.isFinite(startMs) || !Number.isFinite(from.getTime())) return { status: 'INVALID_ACTION', reason: 'invalid-datetime' }

  const m = await ownMeeting(ctx, a.meetingId, a.clientId)
  if (!m) return { status: 'NOT_AUTHORIZED', reason: 'meeting-not-actors' }
  if (m.status === 'scheduled' && new Date(m.start_at).getTime() === startMs) return done(m.id)

  const start = new Date(startMs)
  const changed = await db('meetings')
    .where({ id: m.id, agency_id: ctx.actor.agencyId, status: 'scheduled', start_at: from })
    .update({ start_at: start, end_at: new Date(startMs + a.durationMinutes * 60_000), updated_at: new Date() })
  if (changed !== 1) return { status: 'FAILED', reason: 'changed-since-card' }
  await rescheduleAppointmentReminders({ agencyId: ctx.actor.agencyId, meetingId: m.id, leadId: m.lead_id, startAt: start, title: m.title })
  return done(m.id)
}

async function executeCancel(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = cancelArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const m = await ownMeeting(ctx, parsed.data.meetingId, parsed.data.clientId)
  if (!m) return { status: 'NOT_AUTHORIZED', reason: 'meeting-not-actors' }
  if (m.status === 'cancelled') return done(m.id)
  if (m.status !== 'scheduled') return { status: 'FAILED', reason: 'has-outcome' }
  // The appointment reminders' send-time guard already refuses a cancelled meeting (lib/automations/appointments.ts).
  const changed = await db('meetings')
    .where({ id: m.id, agency_id: ctx.actor.agencyId, status: 'scheduled' })
    .update({ status: 'cancelled', updated_at: new Date() })
  return changed === 1 ? done(m.id) : { status: 'FAILED', reason: 'changed-since-card' }
}

function verifyWith<T extends { meetingId: number; clientId: number }>(schema: z.ZodType<T>, checksFor: (row: MeetingRow, args: T) => VerificationCheck[]) {
  return async (action: ActionProposal, execution: ExecutionResult, ctx: ExecuteContext): Promise<VerificationResult> => {
    const parsed = schema.safeParse(action.args)
    if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
    const target = execution.targetIds?.find((t) => t.kind === 'meeting')
    if (!target) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'no-target-id' }
    const row = await ownMeeting(ctx, parsed.data.meetingId, parsed.data.clientId)
    if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'meeting-not-found-in-agency', targetIds: [target] }
    const checks = checksFor(row, parsed.data)
    const ok = checks.every((c) => c.ok)
    return { state: ok ? 'VERIFIED' : 'MISMATCH', verified: ok, checks, targetIds: [target], reason: ok ? null : 'postcondition-mismatch' }
  }
}

export const rescheduleMeetingAction: AgentActionDefinition = {
  type: 'reschedule_meeting',
  argsSchema: rescheduleArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute: executeReschedule,
  verify: verifyWith(rescheduleArgs, (row, a) => {
    const startMs = new Date(row.start_at).getTime()
    const minutes = Math.round((new Date(row.end_at).getTime() - startMs) / 60_000)
    return [
      { name: 'startAt', ok: startMs === startMsOf(a), expected: new Date(startMsOf(a)).toISOString(), actual: new Date(startMs).toISOString() },
      { name: 'durationMinutes', ok: minutes === a.durationMinutes, expected: a.durationMinutes, actual: minutes },
      { name: 'scheduled', ok: row.status === 'scheduled', expected: 'scheduled', actual: row.status },
    ]
  }),
}

export const cancelMeetingAction: AgentActionDefinition = {
  type: 'cancel_meeting',
  argsSchema: cancelArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute: executeCancel,
  verify: verifyWith(cancelArgs, (row) => [{ name: 'cancelled', ok: row.status === 'cancelled', expected: 'cancelled', actual: row.status }]),
}
