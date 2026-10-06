import 'server-only'
import { db } from '@/config/db'
import { canUseMcp } from '@/lib/flags/mcpFlags'
import { getAgencyProductAccess } from '@/lib/access/productAccess'

/**
 * May this signed-in user connect an MCP client (ChatGPT, Claude) right now?
 *
 * Every fact is read from the database for the session's user id — never from
 * the pending cookie (which carries no identity) or from cached session claims.
 * Checked when the consent page renders AND again when consent is submitted.
 */
export type ConsentIneligibleReason =
  | 'no_user'
  | 'no_agency'
  | 'suspended'
  | 'not_allowlisted'
  | 'trial_not_started'
  | 'subscription_required'

export type ConsentEligibility =
  | { ok: true; user: { id: number; agencyId: number; sessionVersion: number; firstName: string | null } }
  | { ok: false; reason: ConsentIneligibleReason }

export async function checkConsentEligibility(userId: number): Promise<ConsentEligibility> {
  const row = await db('users').where({ id: userId }).first('id', 'agencyId', 'suspended', 'sessionVersion', 'firstName')
  if (!row) return { ok: false, reason: 'no_user' }
  if (typeof row.agencyId !== 'number') return { ok: false, reason: 'no_agency' }
  if (row.suspended) return { ok: false, reason: 'suspended' }
  if (!canUseMcp(row.agencyId)) return { ok: false, reason: 'not_allowlisted' }
  const access = await getAgencyProductAccess(row.agencyId)
  if (!access.hasAccess) {
    return { ok: false, reason: access.status === 'NEVER_STARTED' ? 'trial_not_started' : 'subscription_required' }
  }
  return {
    ok: true,
    user: {
      id: Number(row.id),
      agencyId: row.agencyId,
      sessionVersion: Number(row.sessionVersion ?? 0),
      firstName: typeof row.firstName === 'string' && row.firstName.trim() ? row.firstName : null,
    },
  }
}
