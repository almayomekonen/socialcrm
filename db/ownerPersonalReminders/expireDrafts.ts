import { db } from '@/config/db'

/**
 * T12, draft expiry (Reminder Engine architecture v1.2, v1.6.1). Not scheduled
 * yet: the reminder cron arrives in a later phase.
 *
 * A `proposed` draft past `draftExpiresAt` becomes `discarded`/`expired`, its
 * text is cleared on the spot, its still-pending approval token becomes
 * `expired`, and an audit event is written. All of that is one transaction.
 *
 * LOCK ORDER: reminder rows (L2), then approval rows (LA). It never waits:
 * reminder rows are taken `FOR UPDATE SKIP LOCKED`, so a draft that another
 * transaction holds is simply left for the next run.
 *
 * NOT EXPIRED HERE: a draft whose token is already `approved`. The owner said
 * yes and only the execution is outstanding. That is the resume path's (T15)
 * to finish or refuse, with the lead-time rule; discarding it here would drop
 * an approved request without telling anyone.
 */
export async function expireReminderDrafts(now: Date, limit = 100): Promise<number> {
  return db.transaction(async (trx) => {
    const { rows } = (await trx.raw(
      `SELECT r.id, r."agencyId", r."userId", r."recipientId", r."proposalActionId"
         FROM owner_personal_reminders r
        WHERE r.status = 'proposed'
          AND r."draftExpiresAt" <= ?
          AND NOT EXISTS (
            SELECT 1 FROM wa_assistant_approvals a
             WHERE a."actionId" = r."proposalActionId" AND a."actionId" LIKE 'rem\\_%' AND a.status = 'approved'
          )
        ORDER BY r.id
        LIMIT ?
        FOR UPDATE OF r SKIP LOCKED`,
      [now, limit],
    )) as { rows: { id: string | number; agencyId: number; userId: number; recipientId: string | number; proposalActionId: string | null }[] }
    if (rows.length === 0) return 0

    const ids = rows.map((r) => Number(r.id))
    await trx('owner_personal_reminders')
      .whereIn('id', ids)
      .where({ status: 'proposed' })
      .update({ status: 'discarded', discardReason: 'expired', text: null, finalizedAt: now, updatedAt: trx.fn.now() })

    const actionIds = rows.map((r) => r.proposalActionId).filter((a): a is string => !!a)
    if (actionIds.length > 0) {
      await trx('wa_assistant_approvals')
        .whereIn('actionId', actionIds)
        .where({ status: 'pending' })
        .whereRaw(`"actionId" LIKE 'rem\\_%'`)
        .update({ status: 'expired', updatedAt: trx.fn.now() })
    }

    await trx('owner_personal_reminder_events').insert(
      rows.map((r) => ({
        agencyId: r.agencyId,
        userId: r.userId,
        recipientId: Number(r.recipientId),
        reminderId: Number(r.id),
        type: 'discarded',
        actorKind: 'system',
        actionId: r.proposalActionId,
        fromStatus: 'proposed',
        toStatus: 'discarded',
        reason: 'expired',
      })),
    )
    return ids.length
  })
}
