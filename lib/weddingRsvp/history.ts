import { db } from '@/config/db'
import { WEDDING_RSVP_LOCK_NAMESPACE } from '@/lib/weddingRsvp/config'

export type LatestOutbound = { id: number; text: string; source: string | null; createdAt: Date }

/**
 * The most recent non-failed OUTBOUND message in the conversation, of any kind —
 * RSVP follow-up, rep reply, phone echo, AI. The head-count rule needs exactly
 * this: the question only counts while it is still the last thing said to the guest.
 */
export async function findLatestOutbound(agencyId: number, conversationId: number): Promise<LatestOutbound | null> {
  const row = await db('inbox_messages')
    .where({ agencyId, conversationId, direction: 'outbound' })
    .whereNot('status', 'failed')
    .orderBy('id', 'desc')
    .first('id', 'text', db.raw(`metadata->>'source' AS source`), 'createdAt')
  if (!row) return null
  return { id: Number(row.id), text: String(row.text ?? ''), source: row.source ?? null, createdAt: new Date(row.createdAt) }
}

/**
 * Serializes the check-then-send per conversation (same pattern as
 * withAgencyQuotaLock). Two different numbers arriving in parallel webhooks
 * cannot both see the question as the latest outbound and both get a thank-you.
 */
export async function withConversationLock<T>(conversationId: number, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [conversationId, WEDDING_RSVP_LOCK_NAMESPACE])
    return fn()
  })
}
