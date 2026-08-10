import type { Knex } from 'knex'
import { db } from '@/config/db'
import { resolvedAtFor } from '@/lib/support/status'
import type { PersistedSupportContext } from '@/lib/support/supportContext'
import type { SupportDiagnostics } from '@/lib/support/diagnostics'
import type {
  SupportAuthorKind,
  SupportCategory,
  SupportKind,
  SupportStatus,
} from '@/lib/support/vocabulary'

/**
 * Support request domain primitives.
 *
 * SESSION-FREE BY CONTRACT: every function takes an explicit `agencyId` and puts
 * it in the WHERE clause. Nothing here reads a cookie, and nothing here decides
 * who the caller is — actions/support/* does both and passes the answers down.
 * That split is what lets a future worker call this domain without a session,
 * and what keeps the tenant decision in exactly one place.
 *
 * THE FILE BOUNDARY IS THE TENANCY BOUNDARY. Every query in this file is
 * tenant-scoped. The cross-tenant platform-owner reads live in ./admin.ts and
 * nowhere else, which is what makes queryScope.test.ts a complete audit rather
 * than a spot check.
 */

export type SupportRequestRow = {
  id: number
  agencyId: number
  createdByUserId: number | null
  requesterNameSnapshot: string
  requesterEmailSnapshot: string
  subject: string
  kind: SupportKind
  category: SupportCategory
  status: SupportStatus
  context: PersistedSupportContext | Record<string, never>
  diagnostics: SupportDiagnostics | Record<string, never>
  lastMessageAt: Date | null
  lastMessageAuthorKind: SupportAuthorKind | null
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const COLUMNS = [
  'id',
  'agencyId',
  'createdByUserId',
  'requesterNameSnapshot',
  'requesterEmailSnapshot',
  'subject',
  'kind',
  'category',
  'status',
  'context',
  'diagnostics',
  'lastMessageAt',
  'lastMessageAuthorKind',
  'resolvedAt',
  'createdAt',
  'updatedAt',
] as const

/**
 * Creates the request AND its opening message in one transaction.
 *
 * A request with no first message must never be observable — the opening
 * description IS the first `customer` message, which is what makes the
 * evolution to a full support inbox a write rather than a migration.
 *
 * `body` may legitimately be '' here: when the server resolved a context, the
 * context carries the meaning and the customer was not asked to retype it. The
 * database permits that for a customer message and forbids it for ours; the
 * action layer decides whether this particular empty body was earned.
 */
export async function createSupportRequestSystem(input: {
  agencyId: number
  createdByUserId: number
  requesterName: string
  requesterEmail: string
  subject: string
  kind: SupportKind
  category: SupportCategory
  body: string
  context: PersistedSupportContext | Record<string, never>
  diagnostics: SupportDiagnostics
}): Promise<{ requestId: number }> {
  const now = new Date()

  return db.transaction(async (trx) => {
    const [row] = await trx('support_requests')
      .insert({
        agencyId: input.agencyId,
        createdByUserId: input.createdByUserId,
        requesterNameSnapshot: input.requesterName,
        requesterEmailSnapshot: input.requesterEmail,
        subject: input.subject,
        kind: input.kind,
        category: input.category,
        status: 'open',
        context: trx.raw('?::jsonb', [JSON.stringify(input.context ?? {})]),
        diagnostics: trx.raw('?::jsonb', [JSON.stringify(input.diagnostics ?? {})]),
        lastMessageAt: now,
        lastMessageAuthorKind: 'customer',
        createdAt: now,
        updatedAt: now,
      })
      .returning('id')

    const requestId = Number(typeof row === 'object' ? row.id : row)

    await trx('support_messages').insert({
      requestId,
      // Copied from the row just written above — the parent is verified by
      // construction here, because this transaction created it.
      agencyId: input.agencyId,
      authorKind: 'customer',
      authorUserId: input.createdByUserId,
      body: input.body,
      createdAt: now,
    })

    return { requestId }
  })
}

export async function listSupportRequestsSystem(input: {
  agencyId: number
  viewerUserId: number
  /** Decided by actions/support/* via visibilityScopeFor(). Never derived here. */
  scope: 'own' | 'agency'
  limit?: number
}): Promise<SupportRequestRow[]> {
  const q = db('support_requests')
    .select(...COLUMNS)
    .where({ agencyId: input.agencyId })
    .orderByRaw('"lastMessageAt" DESC NULLS LAST')
    .limit(input.limit ?? 50)

  // Narrows WITHIN the tenant. The agencyId filter above is unconditional and
  // nothing here can widen past it.
  if (input.scope === 'own') q.andWhere({ createdByUserId: input.viewerUserId })

  return (await q) as SupportRequestRow[]
}

export async function getSupportRequestSystem(input: {
  agencyId: number
  requestId: number
}): Promise<SupportRequestRow | null> {
  // Single scoped read. NEVER where({id}) followed by a check — a miss and a
  // cross-tenant hit must be indistinguishable to the caller, so request ids
  // are not enumerable.
  const row = await db('support_requests')
    .select(...COLUMNS)
    .where({ id: input.requestId, agencyId: input.agencyId })
    .first()
  return (row ?? null) as SupportRequestRow | null
}

/**
 * The rate-limit read: "how many requests did THIS USER open in the window?"
 *
 * Keyed by user rather than agency on purpose (see lib/support/rateLimit.ts):
 * one person must never be able to lock their colleagues out of support.
 */
export async function countRequestsByUserSince(userId: number, since: Date): Promise<number> {
  const row = await db('support_requests')
    .where({ createdByUserId: userId })
    .andWhere('createdAt', '>=', since)
    .count<{ count: string }>({ count: '*' })
    .first()
  return Number(row?.count ?? 0)
}

/**
 * The single place a status change touches the clock — shared by the customer
 * reply path and the platform-owner override, so the two can never disagree.
 *
 * `resolvedAt` is set and cleared in the SAME statement that changes `status`,
 * which is what keeps the CHECK constraint satisfiable and stops a reopened
 * request from advertising a resolution that was undone.
 */
export async function applyStatusTransition(
  trx: Knex.Transaction,
  request: { id: number; status: SupportStatus; resolvedAt: Date | null },
  nextStatus: SupportStatus,
  now: Date,
): Promise<void> {
  await trx('support_requests')
    .where({ id: request.id })
    .update({
      status: nextStatus,
      resolvedAt: resolvedAtFor(nextStatus, request.resolvedAt, now),
      updatedAt: now,
    })
}

export async function setSupportRequestStatusSystem(input: {
  agencyId: number
  requestId: number
  toStatus: SupportStatus
}): Promise<{ ok: true } | { reason: 'not_found' }> {
  const now = new Date()
  return db.transaction(async (trx) => {
    const request = await trx('support_requests')
      .select('id', 'status', 'resolvedAt')
      .where({ id: input.requestId, agencyId: input.agencyId })
      .forUpdate()
      .first()
    if (!request) return { reason: 'not_found' as const }

    await applyStatusTransition(trx, request as any, input.toStatus, now)
    return { ok: true as const }
  })
}
