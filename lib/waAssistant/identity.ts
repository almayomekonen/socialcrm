import 'server-only'
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { getFirstName } from '@/lib/users/displayName'
import { isAgentAvailable } from '@/lib/ai/agentAvailability'
import { isWaAssistantAgency } from '@/lib/flags/waAssistantFlags'
import { hasReminderProductAccess } from '@/lib/ownerWhatsappReminders/productAccess'
import type { AgentScope } from '@/lib/agent/types'

/**
 * WHO a WhatsApp message to the platform number speaks for.
 *
 * The only identity is an owner-reminder recipient row: a number the user
 * proved from their own phone with a code issued in their own logged-in
 * session (db/ownerWhatsappRecipients.ts). Meta's signed webhook supplies
 * `from`. Nothing else, no request body and no model output, can name a user,
 * an agency or a permission.
 *
 * EXACTLY ONE active row for the number, or nobody. The phone index is not
 * unique (one number may be verified for several users or agencies), and picking
 * one of several would be guessing whose data to read, so an ambiguous number is
 * refused, never resolved.
 */

export type SenderMatch =
  | { kind: 'match'; recipientId: number; agencyId: number; userId: number }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number }

type ActiveRow = { id: number; agencyId: number; userId: number }

async function activeRowsForPhone(q: Knex | Knex.Transaction, phoneE164: string): Promise<ActiveRow[]> {
  const rows = await q('owner_whatsapp_recipients as r')
    .join('users as u', function () {
      this.on('u.id', '=', 'r.userId').andOn('u.agencyId', '=', 'r.agencyId')
    })
    .where({ 'r.phoneE164': phoneE164, 'r.status': 'active' })
    .whereNotNull('r.verifiedAt')
    .whereRaw('u.suspended IS NOT TRUE')
    .select('r.id', 'r.agencyId', 'r.userId')
  return rows.map((r: Record<string, unknown>) => ({ id: Number(r.id), agencyId: Number(r.agencyId), userId: Number(r.userId) }))
}

/** At the webhook, inside the platform transaction. */
export async function matchAssistantSender(trx: Knex.Transaction, phoneE164: string): Promise<SenderMatch> {
  const rows = await activeRowsForPhone(trx, phoneE164)
  if (rows.length === 0) return { kind: 'none' }
  if (rows.length > 1) return { kind: 'ambiguous', count: rows.length }
  return { kind: 'match', recipientId: rows[0].id, agencyId: rows[0].agencyId, userId: rows[0].userId }
}

export type ScopeRefusal =
  | 'agency_not_enabled'
  | 'agent_not_enabled'
  | 'recipient_not_active'
  | 'ambiguous_number'
  | 'user_not_active'
  | 'no_product_access'

/**
 * EVERY TURN, before anything is read: the job's recipient, user and agency are
 * re-checked from the database, and the Agent scope is rebuilt exactly as
 * lib/ai/integration/autonomousScope.ts builds one without a session. A user
 * who was suspended, moved, opted out or lost product access since the message
 * arrived gets nothing.
 *
 * Product access FAILS CLOSED here (hasReminderProductAccess): an answer sent to
 * a phone cannot be taken back.
 */
export type ScopeResolution =
  | { ok: true; scope: AgentScope; phoneE164: string }
  /** `phoneE164` is present only when the sender is still this verified recipient (a fixed reply may go to it). */
  | { ok: false; reason: ScopeRefusal; phoneE164?: string }

export async function resolveAssistantScope(job: { recipientId: number; agencyId: number; userId: number }, now: Date): Promise<ScopeResolution> {
  if (!isWaAssistantAgency(job.agencyId)) return { ok: false, reason: 'agency_not_enabled' }

  const recipient = (await db('owner_whatsapp_recipients')
    .where({ id: job.recipientId, agencyId: job.agencyId, userId: job.userId, status: 'active' })
    .whereNotNull('verifiedAt')
    .first('phoneE164')) as { phoneE164: string | null } | undefined
  if (!recipient?.phoneE164) return { ok: false, reason: 'recipient_not_active' }

  const rows = await activeRowsForPhone(db, recipient.phoneE164)
  if (rows.length !== 1 || rows[0].id !== job.recipientId) return { ok: false, reason: rows.length > 1 ? 'ambiguous_number' : 'recipient_not_active' }

  const user = (await db('users')
    .where({ id: job.userId, agencyId: job.agencyId })
    .whereRaw('suspended IS NOT TRUE')
    .first('id', 'agencyId', 'role', 'firstName', 'lastName')) as { id: number; agencyId: number; role: AgentScope['role']; firstName: string | null; lastName: string | null } | undefined
  if (!user) return { ok: false, reason: 'user_not_active' }

  const phoneE164 = recipient.phoneE164
  if (!(await isAgentAvailable(job.agencyId))) return { ok: false, reason: 'agent_not_enabled', phoneE164 }
  if (!(await hasReminderProductAccess(job.agencyId, now))) return { ok: false, reason: 'no_product_access', phoneE164 }

  // `getPerms`' admin branch reads the web session, which does not exist here;
  // it returns `[]` for admins unconditionally, so the substitution is exact
  // (same reasoning as autonomousScope.ts). db/filter.ts is not touched.
  const [gotPermIds, plan] = await Promise.all([
    isAdmin(user.role) ? Promise.resolve<number[]>([]) : getPerms(user as never).then((p: { gotPermIds: number[] }) => p.gotPermIds),
    getEffectiveLeadPlan(job.agencyId),
  ])

  return {
    ok: true,
    phoneE164,
    scope: { agencyId: job.agencyId, userId: user.id, role: user.role, gotPermIds, plan, firstName: getFirstName(user as never) },
  }
}
