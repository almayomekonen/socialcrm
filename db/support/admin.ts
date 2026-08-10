import { db } from '@/config/db'
import { applyStatusTransition } from './requests'
import { appendMessageWithVerifiedParent } from './messages'
import type { SupportStatus } from '@/lib/support/vocabulary'
import type { SupportRequestRow } from './requests'

/**
 * THE CROSS-TENANT ALLOWLIST.
 *
 * Every query in this file is deliberately NOT scoped by agencyId, because the
 * platform owner's job is to answer every customer. This is the ENTIRE set of
 * unscoped support queries in the codebase — queryScope.test.ts asserts exactly
 * that, so a new unscoped query added to requests.ts or messages.ts fails the
 * suite rather than slipping through review.
 *
 * Authorization for all of it lives in actions/support/admin.ts behind
 * isPlatformOwner(email) — an email allowlist deliberately SEPARATE from the
 * workspace role system, so an agency "admin" can never reach any of this.
 * Workspace roles and platform ownership are two different authority systems and
 * must never be conflated.
 */

export type AdminSupportRow = SupportRequestRow & { agencyName: string | null }

export async function listSupportRequestsForAdmin(input: {
  status?: SupportStatus | 'unresolved'
  limit?: number
}): Promise<AdminSupportRow[]> {
  const q = db('support_requests as r')
    .leftJoin('agencies as a', 'a.id', 'r.agencyId')
    .select('r.*', db.ref('a.name').as('agencyName'))
    .orderByRaw('r."lastMessageAt" DESC NULLS LAST')
    .limit(input.limit ?? 100)

  if (input.status === 'unresolved') q.whereNot('r.status', 'resolved')
  else if (input.status) q.where('r.status', input.status)

  return (await q) as AdminSupportRow[]
}

export async function getSupportRequestForAdmin(requestId: number): Promise<AdminSupportRow | null> {
  const row = await db('support_requests as r')
    .leftJoin('agencies as a', 'a.id', 'r.agencyId')
    .select('r.*', db.ref('a.name').as('agencyName'))
    .where('r.id', requestId)
    .first()
  return (row ?? null) as AdminSupportRow | null
}

/**
 * Unscoped by design — and STILL copies agencyId from the resolved parent row.
 * The derivation rule is universal; only the scoping assertion is conditional.
 */
export async function appendSupportMessageForAdmin(input: {
  requestId: number
  body: string
  authorUserId: number | null
}) {
  return appendMessageWithVerifiedParent({
    requestId: input.requestId,
    agencyId: null,
    authorKind: 'support',
    // Stored for internal attribution. NEVER rendered to the customer, who
    // always sees "צוות SocialCRM" — the projection in Phase 2's presenters
    // drops this field before it can reach a component.
    authorUserId: input.authorUserId,
    body: input.body,
  })
}

export async function setSupportRequestStatusForAdmin(input: {
  requestId: number
  toStatus: SupportStatus
}): Promise<{ ok: true } | { reason: 'not_found' }> {
  const now = new Date()
  return db.transaction(async (trx) => {
    const request = await trx('support_requests')
      .select('id', 'status', 'resolvedAt')
      .where({ id: input.requestId })
      .forUpdate()
      .first()
    if (!request) return { reason: 'not_found' as const }
    await applyStatusTransition(trx, request as any, input.toStatus, now)
    return { ok: true as const }
  })
}
