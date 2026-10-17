import { db } from '@/config/db'
import { ONE_OFF_RECIPIENT_LOCK_NAMESPACE, REMINDER_CONVERSATION_LOCK_NAMESPACE } from '@/lib/ownerWhatsappReminders/constants'
import { selectReminderRecipients } from '@/lib/ownerWhatsappReminders/selectRecipients'
import { cooldownSql, eligibilitySql, loadActiveRecipients, windowBindings } from './candidates'

/**
 * Database steps of the one-off test send (lib/ownerWhatsappReminders/oneOffSend.ts).
 * Unlike `sendClaimedDelivery`, no transaction stays open while Meta is called:
 *
 *   claimOneOffDelivery   ONE short transaction: serialise on the recipient,
 *                         refuse if the recipient ever had a delivery (single
 *                         use), re-check the recipient, the conversation and
 *                         the recipient selection under the cron's conversation
 *                         lock, then insert the reminder and its delivery
 *                         DIRECTLY as `sending`. The cron only claims
 *                         `scheduled` rows, so it can never pick this one up.
 *   recheckBeforeSend     a fresh read, no transaction, immediately before the
 *                         Meta request: still active, still eligible.
 *
 * The outcome is then written with the shared guarded `recordOutcome`
 * (`WHERE status = 'sending'`). A `sending` row left by an interrupted process
 * is turned into `unknown` by the cron's reaper and is never resent.
 */

const DELIVERIES = 'owner_whatsapp_reminder_deliveries'

export type OneOffRefusal =
  | 'already_used'
  | 'recipient_not_active'
  | 'conversation_not_eligible'
  | 'recipient_not_selected'
  | 'already_reminded'

export type OneOffClaim = { deliveryId: number; reminderId: number; escalatedAt: Date }

export async function claimOneOffDelivery(input: {
  recipientId: number
  agencyId: number
  conversationId: number
  agencyIds: number[]
  now: Date
}): Promise<{ ok: true; claim: OneOffClaim } | { ok: false; reason: OneOffRefusal }> {
  const { recipientId, agencyId, conversationId, now } = input
  return db.transaction(async (trx) => {
    // Concurrent one-off requests for this recipient queue here; the next one
    // sees the delivery the previous one committed and is refused.
    await trx.raw('SELECT pg_advisory_xact_lock(?::int, hashtext(?::text))', [ONE_OFF_RECIPIENT_LOCK_NAMESPACE, String(recipientId)])
    if (await trx(DELIVERIES).where({ recipientId }).first('id')) return { ok: false, reason: 'already_used' }

    const recipient = await trx('owner_whatsapp_recipients as r')
      .join('users as u', function () {
        this.on('u.id', '=', 'r.userId').andOn('u.agencyId', '=', 'r.agencyId')
      })
      .where({ 'r.id': recipientId, 'r.agencyId': agencyId, 'r.status': 'active' })
      .whereNotNull('r.phoneE164')
      .whereNotNull('r.verifiedAt')
      .whereRaw('u.suspended IS NOT TRUE')
      .forUpdate('r')
      .first('r.id')
    if (!recipient) return { ok: false, reason: 'recipient_not_active' }

    // The same lock the cron's scheduler and sender take for this conversation.
    await trx.raw('SELECT pg_advisory_xact_lock(?::int, hashtext(?::text))', [REMINDER_CONVERSATION_LOCK_NAMESPACE, String(conversationId)])
    const { rows } = await trx.raw(
      `SELECT cv."customerWaId", ai."escalatedAt", c."handlerId"
         FROM conversation_ai_state ai
         JOIN inbox_conversations cv ON cv.id = ai."conversationId" AND cv."agencyId" = ai."agencyId"
         LEFT JOIN clients c ON c.id = cv."leadId" AND c."agencyId" = cv."agencyId"
        WHERE cv.id = :conversationId AND cv."agencyId" = :agencyId
          AND ${eligibilitySql('cv', 'ai', 'c')}
          AND ${cooldownSql('cv')}`,
      { ...windowBindings(now, input.agencyIds), conversationId, agencyId },
    )
    if (!rows.length) return { ok: false, reason: 'conversation_not_eligible' }
    const row = rows[0] as { customerWaId: string | null; escalatedAt: string | Date; handlerId: number | null }
    const escalatedAt = new Date(row.escalatedAt)

    // The cron's own rules for who may receive a reminder about this hand-off.
    const selected = selectReminderRecipients({
      handlerUserId: row.handlerId == null ? null : Number(row.handlerId),
      escalatedAt,
      customerWaId: row.customerWaId,
      recipients: (await loadActiveRecipients([agencyId], trx)).get(agencyId) ?? [],
    })
    if (!selected.some((r) => r.recipientId === recipientId)) return { ok: false, reason: 'recipient_not_selected' }

    const inserted = await trx('owner_whatsapp_reminders')
      .insert({ agencyId, conversationId, escalatedAt, status: 'scheduled' })
      .onConflict(['conversationId', 'escalatedAt'])
      .ignore()
      .returning('id')
    if (!inserted.length) return { ok: false, reason: 'already_reminded' }
    const reminderId = Number(inserted[0].id)
    const [d] = await trx(DELIVERIES)
      .insert({ reminderId, recipientId, agencyId, conversationId, status: 'sending', attempts: 1, nextAttemptAt: now, lockedAt: trx.fn.now() })
      .returning('id')
    return { ok: true, claim: { deliveryId: Number(d.id), reminderId, escalatedAt } }
  })
}

/**
 * Fresh read immediately before the Meta request, outside any transaction. An
 * opt-out (keyword or settings) committed before this read cancels the send.
 */
export async function recheckBeforeSend(input: {
  recipientId: number
  agencyId: number
  conversationId: number
  claim: OneOffClaim
  agencyIds: number[]
  now: Date
}): Promise<{ ok: true; phoneE164: string } | { ok: false; reason: 'recipient_not_active' | 'no_longer_eligible' }> {
  const recipient = await db('owner_whatsapp_recipients as r')
    .join('users as u', function () {
      this.on('u.id', '=', 'r.userId').andOn('u.agencyId', '=', 'r.agencyId')
    })
    .where({ 'r.id': input.recipientId, 'r.agencyId': input.agencyId, 'r.status': 'active' })
    .whereNotNull('r.verifiedAt')
    .whereRaw('u.suspended IS NOT TRUE')
    .first('r.phoneE164')
  if (!recipient?.phoneE164) return { ok: false, reason: 'recipient_not_active' }
  const { rows } = await db.raw(
    `SELECT 1
       FROM conversation_ai_state ai
       JOIN inbox_conversations cv ON cv.id = ai."conversationId" AND cv."agencyId" = ai."agencyId"
       LEFT JOIN clients c ON c.id = cv."leadId" AND c."agencyId" = cv."agencyId"
      WHERE cv.id = :conversationId AND cv."agencyId" = :agencyId AND ai."escalatedAt" = :escalatedAt
        AND ${eligibilitySql('cv', 'ai', 'c')}
        AND ${cooldownSql('cv', ':reminderId::bigint')}`,
    { ...windowBindings(input.now, input.agencyIds), conversationId: input.conversationId, agencyId: input.agencyId, escalatedAt: input.claim.escalatedAt, reminderId: input.claim.reminderId },
  )
  if (!rows.length) return { ok: false, reason: 'no_longer_eligible' }
  return { ok: true, phoneE164: recipient.phoneE164 }
}
