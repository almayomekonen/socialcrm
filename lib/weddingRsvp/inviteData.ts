import { db } from '@/config/db'
import { INVITE_KIND, WEDDING_INVITE_LOCK_NAMESPACE } from '@/lib/weddingRsvp/config'

/** SQL: an inbox_conversations alias's customerWaId, normalized to 972… E.164 digits. */
const normalizedWaIdSql = (alias: string) => `(CASE
  WHEN regexp_replace(${alias}."customerWaId", '\\D', '', 'g') ~ '^0[2-9][0-9]{8}$'
    THEN '972' || substr(regexp_replace(${alias}."customerWaId", '\\D', '', 'g'), 2)
  ELSE regexp_replace(${alias}."customerWaId", '\\D', '', 'g') END)`

/**
 * Has this guest already been sent the wedding invite — by ANY path? Counts this
 * module's template sends (metadata.kind) and the invites sent from the phone
 * (Coexistence echoes: an image whose caption carries the invite text). Failed
 * sends do not count, so a failed attempt can be retried.
 */
export async function countInvitesSent(agencyId: number, waId: string): Promise<number> {
  const row = await db('inbox_messages as m')
    .join('inbox_conversations as c', 'c.id', 'm.conversationId')
    .where('m.agencyId', agencyId)
    .andWhere('c.agencyId', agencyId)
    .andWhere('m.direction', 'outbound')
    .andWhereNot('m.status', 'failed')
    .andWhereRaw(`${normalizedWaIdSql('c')} = ?`, [waId])
    .andWhere(function () {
      this.whereRaw(`m.metadata->>'kind' = ?`, [INVITE_KIND]).orWhereRaw(
        `regexp_replace(m.text || m.payload::text || COALESCE(m."rawPayload"::text, ''), '[^א-ת]', '', 'g') LIKE '%להזמינכםלחגוג%'`,
      )
    })
    .count<{ count: string }>('m.id as count')
    .first()
  return Number(row?.count ?? 0)
}

export type ExistingConversation = { id: number; leadId: number | null; businessPhoneNumberId: string }

/** The guest's existing conversation in this agency, whatever format its wa_id was stored in. */
export async function findConversationForWaId(agencyId: number, waId: string): Promise<ExistingConversation | null> {
  const row = await db('inbox_conversations as c')
    .where('c.agencyId', agencyId)
    .andWhere('c.channel', 'whatsapp')
    .andWhereRaw(`${normalizedWaIdSql('c')} = ?`, [waId])
    .orderByRaw('c."lastMessageAt" DESC NULLS LAST')
    .orderBy('c.id', 'desc')
    .first('c.id', 'c.leadId', 'c.businessPhoneNumberId')
  if (!row) return null
  return {
    id: Number(row.id),
    leadId: row.leadId == null ? null : Number(row.leadId),
    businessPhoneNumberId: String(row.businessPhoneNumberId),
  }
}

/** The agency's connected WhatsApp business numbers. */
export async function listAgencyPhoneNumberIds(agencyId: number): Promise<string[]> {
  const rows = await db('whatsapp_connections').where({ agency_id: agencyId }).select('phone_number_id')
  return rows.map((r: { phone_number_id: string }) => String(r.phone_number_id))
}

/**
 * Serializes the whole check-then-create-then-send for one guest, so a
 * double-click or a retried request cannot create two leads or send twice.
 */
export async function withInviteLock<T>(agencyId: number, waId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [`${agencyId}:${waId}`, WEDDING_INVITE_LOCK_NAMESPACE])
    return fn()
  })
}
