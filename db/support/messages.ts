import type { Knex } from 'knex'
import { db } from '@/config/db'
import { nextStatusAfterReply } from '@/lib/support/status'
import { applyStatusTransition } from './requests'
import type { SupportAuthorKind, SupportStatus } from '@/lib/support/vocabulary'

/**
 * Support conversation messages.
 *
 * `support_messages."agencyId"` is DEFENCE IN DEPTH, NOT THE SOURCE OF TRUTH.
 *
 * The tenant of a message is a DERIVED fact — whatever tenant owns its parent
 * request. The column exists so a scoped read needs no join and so a corrupted
 * write is detectable; it does NOT exist so a caller can assert a tenant.
 */

export type SupportMessageRow = {
  id: number
  requestId: number
  agencyId: number
  authorKind: SupportAuthorKind
  authorUserId: number | null
  body: string
  createdAt: Date
}

const COLUMNS = [
  'id',
  'requestId',
  'agencyId',
  'authorKind',
  'authorUserId',
  'body',
  'createdAt',
] as const

/**
 * Shared by the tenant-scoped and platform-owner paths.
 *
 * `agencyId: null` means "do not scope" and is reachable ONLY from
 * db/support/admin.ts. The derivation rule below is universal; only the scoping
 * assertion is conditional.
 *
 * Order matters and is the security property:
 *
 *   1. Resolve the parent WHERE id [AND agencyId] ... FOR UPDATE
 *   2. No parent -> return not_found. NO INSERT HAPPENS.
 *   3. Insert with agencyId COPIED FROM THE RESOLVED ROW, never the argument.
 *   4. Update the parent (lastMessage*, status, clock) in the same transaction.
 *
 * Step 3 is what makes the column unable to disagree with its parent even if a
 * caller lies, and what gives the owner path a correct tenant with no assertion
 * at all. FOR UPDATE in step 1 holds the row so steps 3-4 are safe against a
 * concurrent status change.
 */
export async function appendMessageWithVerifiedParent(
  input: {
    requestId: number
    /** Tenant ASSERTION used to scope the parent lookup. Never the value written. */
    agencyId: number | null
    authorKind: SupportAuthorKind
    authorUserId: number | null
    body: string
  },
  trxOrDb: Knex | Knex.Transaction = db,
): Promise<{ ok: true; messageId: number; nextStatus: SupportStatus } | { reason: 'not_found' }> {
  const now = new Date()

  return (trxOrDb as Knex).transaction(async (trx) => {
    const parentQuery = trx('support_requests')
      .select('id', 'agencyId', 'status', 'resolvedAt')
      .where({ id: input.requestId })
      .forUpdate()
    if (input.agencyId != null) parentQuery.andWhere({ agencyId: input.agencyId })

    const request = await parentQuery.first()

    // A caller naming another tenant's request gets the SAME answer as one
    // naming a request that does not exist.
    if (!request) return { reason: 'not_found' as const }

    const [inserted] = await trx('support_messages')
      .insert({
        requestId: request.id,
        agencyId: request.agencyId,
        authorKind: input.authorKind,
        authorUserId: input.authorUserId,
        body: input.body,
        createdAt: now,
      })
      .returning('id')

    const nextStatus = nextStatusAfterReply(request.status as SupportStatus, input.authorKind)
    await trx('support_requests').where({ id: request.id }).update({
      lastMessageAt: now,
      lastMessageAuthorKind: input.authorKind,
    })
    await applyStatusTransition(trx, request as any, nextStatus, now)

    return {
      ok: true as const,
      messageId: Number(typeof inserted === 'object' ? inserted.id : inserted),
      nextStatus,
    }
  })
}

/** The tenant-scoped entry point. Used by every customer surface. */
export async function appendSupportMessageSystem(input: {
  agencyId: number
  requestId: number
  authorKind: SupportAuthorKind
  authorUserId: number | null
  body: string
}) {
  return appendMessageWithVerifiedParent({
    requestId: input.requestId,
    agencyId: input.agencyId,
    authorKind: input.authorKind,
    authorUserId: input.authorUserId,
    body: input.body,
  })
}

export async function listSupportMessagesSystem(input: {
  agencyId: number
  requestId: number
}): Promise<SupportMessageRow[]> {
  return (await db('support_messages')
    .select(...COLUMNS)
    .where({ requestId: input.requestId, agencyId: input.agencyId })
    .orderBy('createdAt', 'asc')) as SupportMessageRow[]
}
