import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { setLeadFollowUpSystem } from '@/lib/system/setLeadFollowUpSystem'
import { startOfBusinessDayMs } from '@/lib/today/time'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationCheck, VerificationResult } from '../types'

/**
 * `create_follow_up` — the second action, and the proof the runtime is reusable.
 *
 * IT IS SHAPED NOTHING LIKE `create_task`, which is the point. A task is a ROW
 * in `tasks`; a follow-up is two COLUMNS on the lead itself — `nextFollowUpAt`
 * and `followUpNote` — so this is an UPDATE, its target id is the lead rather
 * than something the mutation returns, and setting one REPLACES any existing
 * one. None of that reached the runtime: intent, policy, claiming, the execution
 * lock, verification and audit are the same generic machinery, and only this
 * file knows what a follow-up is.
 *
 * DATE-LEVEL ONLY, DELIBERATELY. `clients."nextFollowUpAt"` is a timestamptz and
 * could carry a time, but the product's own control is `<input type='date'>`
 * writing local midnight, so a follow-up in SocialCRM means a DAY. Accepting a
 * time here would let the agent create a follow-up no part of the product can
 * display or edit, and would quietly make the agent's data model diverge from
 * the one every other surface reads.
 *
 * THE MIDNIGHT IS THE BUSINESS DAY'S, not the server's. `new Date('2026-09-10')`
 * on Vercel is UTC midnight, three hours off Jerusalem's — which would put a
 * follow-up on the wrong side of the day boundary that `getFollowUpsDueToday`
 * computes, so a follow-up "for the 10th" could surface on the 9th. The instant
 * is derived through `startOfBusinessDayMs`, the same authority the Today brief
 * uses, rather than by hand.
 */

const createFollowUpArgs = z.object({
  /** The lead. A follow-up has no identity of its own — it IS lead state. */
  clientId: z.number().int().positive(),
  /** `YYYY-MM-DD`. The product stores a day; nothing here pretends otherwise. */
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** One line of context, exactly as the product's own control offers. */
  note: z.string().trim().max(500).nullable().optional(),
})

export type CreateFollowUpArgs = z.infer<typeof createFollowUpArgs>

type LeadRow = { id: number; agencyId: number; nextFollowUpAt: Date | string | null; followUpNote: string | null; userId: number | null }

/**
 * The calendar date as an instant, in the business timezone.
 *
 * Noon UTC is used as the probe instant because Jerusalem is UTC+2/+3, so noon
 * UTC always falls on the same calendar day there — which makes
 * `startOfBusinessDayMs` return that day's midnight and never the one before.
 */
export function businessMidnightMs(dateStr: string): number {
  return startOfBusinessDayMs(Date.parse(`${dateStr}T12:00:00Z`))
}

function checksFor(row: LeadRow, args: CreateFollowUpArgs, expectedMs: number): VerificationCheck[] {
  const actualMs = row.nextFollowUpAt ? new Date(row.nextFollowUpAt).getTime() : null
  const expectedNote = args.note?.trim() || null
  return [
    { name: 'agencyOwnership', ok: row.agencyId != null, expected: 'lead in acting agency', actual: row.agencyId },
    { name: 'clientId', ok: row.id === args.clientId, expected: args.clientId, actual: row.id },
    { name: 'followUpExists', ok: actualMs != null, expected: 'nextFollowUpAt set', actual: actualMs },
    { name: 'followUpDate', ok: actualMs === expectedMs, expected: args.at, actual: actualMs },
    { name: 'note', ok: (row.followUpNote ?? null) === expectedNote, expected: expectedNote, actual: row.followUpNote ?? null },
  ]
}

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = createFollowUpArgs.safeParse(action.args)
  // Validated before anything is written, and RETURNED rather than thrown: a
  // throw is classified UNKNOWN by the runtime, which is the one verdict a
  // malformed argument definitely does not deserve.
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const args = parsed.data

  const at = new Date(businessMidnightMs(args.at))
  if (Number.isNaN(at.getTime())) return { status: 'INVALID_ACTION', reason: 'invalid-date' }

  /**
   * The write IS the authorization check. `setLeadFollowUpSystem` scopes its
   * UPDATE by agency and, for non-admins, by the leads this rep owns — so a
   * target outside either bound updates zero rows and reports it, rather than
   * being checked separately and racing the write.
   */
  const { updated } = await setLeadFollowUpSystem({
    leadId: args.clientId,
    agencyId: ctx.actor.agencyId,
    role: ctx.actor.role,
    gotPermIds: ctx.actor.gotPermIds,
    at,
    note: args.note ?? null,
    nowMs: ctx.nowMs,
  })

  if (!updated) return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' }

  // The lead IS the target: a follow-up has no id of its own.
  return { status: 'SUCCESS', targetIds: [{ kind: 'lead', id: String(args.clientId) }] }
}

async function verify(
  action: ActionProposal,
  _execution: ExecutionResult,
  ctx: ExecuteContext,
): Promise<VerificationResult> {
  const parsed = createFollowUpArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const args = parsed.data

  /**
   * Re-read by the ARGUMENTS' lead id and the authenticated agency, not by
   * anything the executor returned. For an UPDATE there is no new id to trust,
   * and reading back the row the executor claims it touched would just be asking
   * the executor twice.
   */
  const row = (await db('clients')
    .where({ id: args.clientId, agencyId: ctx.actor.agencyId })
    .first('id', 'agencyId', 'nextFollowUpAt', 'followUpNote', 'userId')) as LeadRow | undefined

  if (!row) {
    return {
      state: 'NOT_FOUND', verified: false, checks: [],
      reason: 'lead-not-found-in-agency',
      targetIds: [{ kind: 'lead', id: String(args.clientId) }],
    }
  }

  const checks = checksFor(row, args, businessMidnightMs(args.at))
  const allOk = checks.every((c) => c.ok)
  return {
    state: allOk ? 'VERIFIED' : 'MISMATCH',
    verified: allOk,
    checks,
    targetIds: [{ kind: 'lead', id: String(row.id) }],
    reason: allOk ? null : 'postcondition-mismatch',
  }
}

/**
 * LOW_RISK_WRITE, confirmed against what the action actually does rather than
 * assumed from its neighbour: it touches two columns on one lead inside the
 * authenticated agency, sends nothing anywhere, never reaches the customer, and
 * is undone by the product's own `clearLeadFollowUp` or by setting another date.
 *
 * The one thing worth naming honestly: setting a follow-up REPLACES an existing
 * one, so an explicit command can overwrite a date a rep chose by hand. That is
 * the Follow-Up Engine's own documented semantics on every surface, not
 * something introduced here, and preserving it is what keeps the agent's
 * behaviour identical to the control beside it. `requiresApproval` stays unset:
 * the risk ladder decides, so a command executes and an agent's own idea waits.
 */
export const createFollowUpAction: AgentActionDefinition = {
  type: 'create_follow_up',
  argsSchema: createFollowUpArgs as never,
  risk: 'LOW_RISK_WRITE',
  execute,
  verify,
}
