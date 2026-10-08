import { db } from '@/config/db'
import { RSVP_REQUEST_KIND, WEDDING_RSVP_REQUEST_LOCK_NAMESPACE } from '@/lib/weddingRsvp/config'
import { waSql } from '@/lib/weddingRsvp/integrationSql'

/** The free-form RSVP's opening words (lib/weddingRsvp/config RSVP_BODY) — it was persisted without a marker. */
const FREE_FORM_RSVP_TEXT = 'נשמח לאישור הגעה לחתונה'

/**
 * Has this guest already been asked to RSVP — by ANY path? Counts template RSVP
 * requests (metadata.kind) and the earlier free-form interactive RSVP (recognised
 * by its text). Failed sends do not count, so a failed attempt can be retried.
 */
export async function countRsvpRequestsSent(agencyId: number, waId: string): Promise<number> {
  const row = await db('inbox_messages as m')
    .join('inbox_conversations as c', 'c.id', 'm.conversationId')
    .where('m.agencyId', agencyId)
    .andWhere('c.agencyId', agencyId)
    .andWhere('m.direction', 'outbound')
    .andWhereNot('m.status', 'failed')
    .andWhereRaw(`${waSql('c')} = ?`, [waId])
    .andWhere(function () {
      this.whereRaw(`m.metadata->>'kind' = ?`, [RSVP_REQUEST_KIND]).orWhereRaw(`COALESCE(m.text, '') LIKE ?`, [`%${FREE_FORM_RSVP_TEXT}%`])
    })
    .count<{ count: string }>('m.id as count')
    .first()
  return Number(row?.count ?? 0)
}

/**
 * Did THIS conversation receive a template RSVP request? This is what authorizes the
 * automatic follow-ups (head-count question, thank-you) for guests asked through the
 * Wedding Manager — the free-form path keeps its own allowlist.
 */
export async function conversationHasRsvpRequest(conversationId: number): Promise<boolean> {
  const row = await db('inbox_messages')
    .where({ conversationId, direction: 'outbound' })
    .andWhereNot('status', 'failed')
    .andWhereRaw(`metadata->>'kind' = ?`, [RSVP_REQUEST_KIND])
    .first('id')
  return Boolean(row)
}

/** One check-then-send per guest at a time: a double request cannot send twice. */
export async function withRsvpRequestLock<T>(agencyId: number, waId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [`${agencyId}:${waId}`, WEDDING_RSVP_REQUEST_LOCK_NAMESPACE])
    return fn()
  })
}
