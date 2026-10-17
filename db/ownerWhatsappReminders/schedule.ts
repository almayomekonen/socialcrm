import { db } from '@/config/db'
import { REMINDER_CONVERSATION_LOCK_NAMESPACE } from '@/lib/ownerWhatsappReminders/constants'
import type { ReminderCandidate } from './candidates'
import { cooldownSql, eligibilitySql, windowBindings, type AgencyScope } from './candidates'

/**
 * Create the reminder and one delivery per recipient, atomically, under the
 * per-conversation advisory lock that the sender also takes. Eligibility and
 * the cooldown are re-checked inside the lock, so two ticks (or a tick and a
 * send) cannot both act on one conversation. The unique (conversation,
 * escalation) key is the last line of defence.
 */
export async function scheduleReminder(input: {
  candidate: ReminderCandidate
  recipientIds: number[]
  agencyIds: AgencyScope
  notBefore: Date
  now: Date
}): Promise<'scheduled' | 'skipped'> {
  const { candidate, recipientIds } = input
  if (!recipientIds.length) return 'skipped'
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(?::int, hashtext(?::text))', [REMINDER_CONVERSATION_LOCK_NAMESPACE, String(candidate.conversationId)])
    const { rows } = await trx.raw(
      `SELECT 1
         FROM conversation_ai_state ai
         JOIN inbox_conversations cv ON cv.id = ai."conversationId" AND cv."agencyId" = ai."agencyId"
         LEFT JOIN clients c ON c.id = cv."leadId" AND c."agencyId" = cv."agencyId"
        WHERE cv.id = :conversationId AND cv."agencyId" = :agencyId AND ai."escalatedAt" = :escalatedAtExact::timestamptz
          AND ${eligibilitySql('cv', 'ai', 'c')}
          AND ${cooldownSql('cv')}`,
      { ...windowBindings(input.now, input.agencyIds), conversationId: candidate.conversationId, agencyId: candidate.agencyId, escalatedAtExact: candidate.escalatedAtExact },
    )
    if (!rows.length) return 'skipped'
    const inserted = await trx('owner_whatsapp_reminders')
      .insert({ agencyId: candidate.agencyId, conversationId: candidate.conversationId, escalatedAt: candidate.escalatedAtExact, status: 'scheduled' })
      .onConflict(['conversationId', 'escalatedAt'])
      .ignore()
      .returning('id')
    if (!inserted.length) return 'skipped'
    const reminderId = Number(inserted[0].id)
    await trx('owner_whatsapp_reminder_deliveries').insert(
      recipientIds.map((recipientId) => ({
        reminderId,
        recipientId,
        agencyId: candidate.agencyId,
        conversationId: candidate.conversationId,
        status: 'scheduled',
        nextAttemptAt: input.notBefore,
      })),
    )
    return 'scheduled'
  })
}
