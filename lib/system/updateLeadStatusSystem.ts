import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { emitLeadStatusChanged } from '@/lib/automations/statusChanged'
import { LEAD_STATUSES, type LeadStatus } from '@/lib/mcp/present'

/**
 * System / server lead-status write — NO product-session authorization.
 *
 * The counterpart of the `updateLead` server action's status branch
 * (actions/clients.ts), for a caller that has already established who is
 * acting (the Action Runtime). Same reasons as `setLeadFollowUpSystem`: the
 * server action re-derives identity from the request cookie, which a
 * WhatsApp-approved action does not have.
 *
 * THE GATE IS PASSED IN, NOT DROPPED. `updateLead` scopes its write by agency
 * and, for non-admins, `userId IN gotPermIds`. This reproduces that WHERE
 * clause exactly from the caller-supplied scope.
 *
 * WHAT IS THE SAME AS THE WEB DROPDOWN: the columns written (`status`,
 * `statusChangedAt`, `lastActivityAt`, `updatedAt`) and the ONE emitter every
 * status-writing surface uses (`emitLeadStatusChanged`: transition log,
 * notifications, automations), with source 'manual' and the acting user.
 *
 * WHAT IS STRICTER, because the change was approved on a card the owner read:
 *   - one transaction, the lead row locked FOR UPDATE;
 *   - the status must still be `fromStatus`, the value the card showed. If it
 *     changed meanwhile nothing is written (`stale`), so a tap can never
 *     overwrite a colleague's newer change it never saw;
 *   - already in the target status → nothing is written, nothing is emitted.
 * The transition log joins the same transaction (`trx`), so a rolled-back write
 * records no history.
 *
 * NEVER import this from client/UI code.
 */

export type UpdateLeadStatusResult =
  | { result: 'updated'; leadName: string; at: Date }
  | { result: 'already'; leadName: string }
  | { result: 'stale'; current: string | null }
  | { result: 'not_permitted' }

export function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v)
}

export async function updateLeadStatusSystem(input: {
  leadId: number
  /** Authenticated agency. Never a caller or model value. */
  agencyId: number
  role: string
  /** Lead owners this actor may write to. Applied for non-admins only. */
  gotPermIds: number[]
  actorUserId: number
  /** The status the approval card showed. */
  fromStatus: string | null
  toStatus: LeadStatus
  nowMs?: number
}): Promise<UpdateLeadStatusResult> {
  const at = new Date(input.nowMs ?? Date.now())
  return db.transaction(async (trx) => {
    const q = trx('clients').where({ id: input.leadId, agencyId: input.agencyId })
    if (!isAdmin(input.role as Parameters<typeof isAdmin>[0])) q.whereIn('userId', input.gotPermIds)
    const row = (await q.forUpdate().first('id', 'status', 'firstName', 'lastName')) as
      | { id: number; status: string | null; firstName: string | null; lastName: string | null }
      | undefined
    if (!row) return { result: 'not_permitted' as const }

    const leadName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim()
    if (row.status === input.toStatus) return { result: 'already' as const, leadName }
    if ((row.status ?? null) !== (input.fromStatus ?? null)) return { result: 'stale' as const, current: row.status ?? null }

    await trx('clients')
      .where({ id: row.id, agencyId: input.agencyId })
      .update({ status: input.toStatus, statusChangedAt: at, lastActivityAt: at, updatedAt: at })

    await emitLeadStatusChanged({
      agencyId: input.agencyId,
      leadId: row.id,
      newStatus: input.toStatus,
      previousStatus: row.status ?? null,
      source: 'manual',
      occurredAt: at,
      actorUserId: input.actorUserId,
      leadName: leadName || null,
      trx,
    })
    return { result: 'updated' as const, leadName, at }
  })
}
