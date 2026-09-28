import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { getMeeting } from '@/db/meetings'
import { createMeetingSystem } from '@/lib/system/createMeetingSystem'
import { businessInstantMs } from '@/lib/today/time'
import { BUSINESS_TZ } from '@/lib/today/constants'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationCheck, VerificationResult } from '../types'

/**
 * `create_meeting` — the third action, and the first one where TIME is real.
 *
 * A task stores a date and a follow-up stores a date, so both actions were built
 * around the rule that SocialCRM does not keep a time of day. A meeting breaks
 * that rule honestly: `meetings.start_at` and `end_at` are timestamptz and the
 * row carries its own `timezone`, because a meeting at ten and a meeting at four
 * are different meetings. Duration is expressed the way the table expresses it —
 * as an end instant — rather than as a column that does not exist.
 *
 * THE WALL CLOCK IS CONVERTED, NOT ASSUMED. "מחר ב-10" means ten where the rep
 * is. `new Date('2026-09-07T10:00')` on a Vercel server is 10:00 UTC, which is
 * 13:00 in Jerusalem — every meeting three hours late, invisibly. The instant
 * comes from `businessInstantMs`, which resolves the offset from the Intl
 * database at that instant and is therefore correct across DST.
 *
 * THE CRM ROW IS THE SOURCE OF TRUTH, and Google is not in this path. The
 * product's own action says so in as many words: the occurrence is true the
 * moment the row exists, the automation event fires before any mirroring, and a
 * failed push only sets `sync_status`. So this creates a real meeting and leaves
 * it `pending` for the existing user-triggered retry — it does not integrate a
 * calendar provider.
 */

/** `HH:MM`, 24-hour. The product's own calendar UI speaks in these terms. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const createMeetingArgs = z.object({
  clientId: z.number().int().positive(),
  title: z.string().trim().min(1).max(255),
  /** `YYYY-MM-DD` in the business timezone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** `HH:MM` in the business timezone. Unlike a task, this is really stored. */
  startTime: z.string().regex(TIME_RE),
  /**
   * Bounded at both ends. A zero-length meeting is not a meeting, and a
   * twelve-hour one is almost always a mis-parsed input rather than a request.
   */
  durationMinutes: z.number().int().min(5).max(600),
  note: z.string().trim().max(5000).nullable().optional(),
})

export type CreateMeetingArgs = z.infer<typeof createMeetingArgs>

function checksFor(
  row: { agency_id: number; lead_id: number | null; title: string; start_at: Date; end_at: Date; description: string | null; status: string },
  args: CreateMeetingArgs,
  actorAgencyId: number,
): VerificationCheck[] {
  const startMs = new Date(row.start_at).getTime()
  const endMs = new Date(row.end_at).getTime()
  const expectedStart = businessInstantMs(args.date, args.startTime)
  const expectedNote = args.note?.trim() || null
  return [
    { name: 'agencyOwnership', ok: row.agency_id === actorAgencyId, expected: actorAgencyId, actual: row.agency_id },
    { name: 'clientId', ok: row.lead_id === args.clientId, expected: args.clientId, actual: row.lead_id },
    { name: 'title', ok: row.title === args.title, expected: args.title, actual: row.title },
    { name: 'startAt', ok: startMs === expectedStart, expected: new Date(expectedStart).toISOString(), actual: new Date(startMs).toISOString() },
    {
      name: 'durationMinutes',
      ok: Math.round((endMs - startMs) / 60_000) === args.durationMinutes,
      expected: args.durationMinutes,
      actual: Math.round((endMs - startMs) / 60_000),
    },
    { name: 'note', ok: (row.description ?? null) === expectedNote, expected: expectedNote, actual: row.description ?? null },
    { name: 'scheduled', ok: row.status === 'scheduled', expected: 'scheduled', actual: row.status },
  ]
}

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = createMeetingArgs.safeParse(action.args)
  // Returned rather than thrown: a throw is classified UNKNOWN by the runtime,
  // which a malformed argument does not deserve.
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const args = parsed.data

  const startMs = businessInstantMs(args.date, args.startTime)
  if (!Number.isFinite(startMs)) return { status: 'INVALID_ACTION', reason: 'invalid-datetime' }

  /**
   * Agency AND owner, matching the other two agent actions. Meetings carry their
   * own `agency_id`, so the tenant bound could be enforced at insert — but the
   * LEAD is what a non-admin rep is restricted to, and a meeting attached to a
   * colleague's lead is an agency-scoped write that is still not an authorised
   * one.
   */
  const leadQuery = db('clients').where({ id: args.clientId, agencyId: ctx.actor.agencyId })
  if (!isAdmin(ctx.actor.role as Parameters<typeof isAdmin>[0])) {
    leadQuery.whereIn('userId', ctx.actor.gotPermIds)
  }
  const lead = await leadQuery.first('id')
  if (!lead) return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency' }

  const created = await createMeetingSystem({
    agencyId: ctx.actor.agencyId,
    organizerUserId: ctx.actor.userId,
    leadId: args.clientId,
    title: args.title,
    description: args.note ?? null,
    timezone: BUSINESS_TZ,
    startAt: new Date(startMs),
    endAt: new Date(startMs + args.durationMinutes * 60_000),
  })

  if (created.ok === false) return { status: 'FAILED', reason: created.reason }

  return { status: 'SUCCESS', targetIds: [{ kind: 'meeting', id: String(created.meetingId) }] }
}

async function verify(
  action: ActionProposal,
  execution: ExecutionResult,
  ctx: ExecuteContext,
): Promise<VerificationResult> {
  const parsed = createMeetingArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }

  const target = execution.targetIds?.find((t) => t.kind === 'meeting')
  if (!target) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'no-target-id' }

  // Agency-scoped read: a meeting belonging to another tenant is NOT_FOUND here,
  // never a row this function could accidentally approve.
  const row = await getMeeting(Number(target.id), ctx.actor.agencyId)
  if (!row) {
    return {
      state: 'NOT_FOUND', verified: false, checks: [],
      reason: 'meeting-not-found-in-agency', targetIds: [target],
    }
  }

  const checks = checksFor(row, parsed.data, ctx.actor.agencyId)
  const allOk = checks.every((c) => c.ok)
  const label = await leadLabel(row.lead_id, ctx.actor.agencyId)
  return {
    state: allOk ? 'VERIFIED' : 'MISMATCH',
    verified: allOk,
    checks,
    targetIds: [{ kind: 'meeting', id: String(row.id), label }],
    reason: allOk ? null : 'postcondition-mismatch',
  }
}

/** The lead's name, for a confirmation sentence. Read back, never asserted. */
async function leadLabel(leadId: number | null, agencyId: number): Promise<string | undefined> {
  if (leadId == null) return undefined
  const row = (await db('clients').where({ id: leadId, agencyId }).first('firstName', 'lastName')) as
    | { firstName: string | null; lastName: string | null }
    | undefined
  if (!row) return undefined
  return [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || undefined
}

/**
 * LOW_RISK_WRITE, confirmed against what the action does rather than assumed
 * from the word "meeting": it inserts one row inside the authenticated agency,
 * attached to one of that agency's leads, and sends nothing to anyone. No
 * invitation leaves the system — attendees are not part of this contract and
 * Google is not in this path — so nothing here reaches the customer.
 *
 * That last clause is the whole reason it can be low risk, and it is exactly the
 * clause that would stop being true the moment attendee invitations were added.
 * A future `create_meeting` that emails an external attendee is a different
 * action at a different rung.
 */
export const createMeetingAction: AgentActionDefinition = {
  type: 'create_meeting',
  argsSchema: createMeetingArgs as never,
  risk: 'LOW_RISK_WRITE',
  execute,
  verify,
}
