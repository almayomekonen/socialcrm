import type { Knex } from 'knex'
import { db } from '@/config/db'
import {
  OWNER_WA_ASSISTANT_CONSENT,
  OWNER_WA_CONSENT,
  OWNER_WA_PERSONAL_REMINDERS_CONSENT,
  consentCoversAssistant,
  consentCoversPersonalReminders,
} from '@/lib/whatsapp/platform/consentText'
import { insertReminderEvents, type ReminderEvent } from './events'

/**
 * Consent v5 transitions and the cancellations they imply (Reminder Engine
 * Phase 4, architecture v1.1 A1, v1.2 §3).
 *
 *   grant (Settings only)        v2 / v3 / v4 → v5
 *   withdraw personal reminders  v5 → v4      + cancel future personal reminders
 *   withdraw the assistant       v3/v4/v5 → v2 + cancel them too (if it was v5)
 *   opt-out (Settings / "הסר")   status → opted_out + cancel them
 *
 * One transaction each. LOCK ORDER: recipient (L1) → reminder rows (L2,
 * ascending id) → approval rows (LA). It is the order the send gate uses, so the
 * two serialize and cannot deadlock. A reminder the gate already moved to
 * `dispatching` cannot be stopped; it is counted as `inFlight` so the caller can
 * say so honestly.
 */

const RECIPIENTS = 'owner_whatsapp_recipients'
const REMINDERS = 'owner_personal_reminders'

type LockedRecipient = { id: number; agencyId: number; userId: number; status: string; consentTextVersion: string }

async function lockOwnRecipient(trx: Knex.Transaction, agencyId: number, userId: number): Promise<LockedRecipient | null> {
  const row = (await trx(RECIPIENTS)
    .where({ agencyId, userId })
    .forUpdate()
    .first('id', 'agencyId', 'userId', 'status', 'consentTextVersion')) as Record<string, unknown> | undefined
  return row
    ? { id: Number(row.id), agencyId: Number(row.agencyId), userId: Number(row.userId), status: String(row.status), consentTextVersion: String(row.consentTextVersion) }
    : null
}

async function recordConsent(trx: Knex.Transaction, recipientId: number, version: string) {
  await trx(RECIPIENTS)
    .where({ id: recipientId })
    .update({ consentTextVersion: version, consentAt: trx.fn.now(), consentSource: 'settings', updatedAt: trx.fn.now() })
}

export type CancelledReminders = { cancelled: number; discarded: number; inFlight: number }

/**
 * Cancel every future personal reminder of these recipients, inside the
 * caller's transaction, which must already hold the recipient row locks.
 *   scheduled / claimed → cancelled (cancelReason = `reason`)
 *   proposed (a draft)  → discarded ('consent'), text cleared, its pending token expired
 *   dispatching         → untouched: counted in `inFlight`
 */
export async function cancelLiveReminders(
  trx: Knex.Transaction,
  recipientIds: readonly number[],
  reason: 'consent_withdrawn' | 'opted_out',
  actorKind: ReminderEvent['actorKind'],
): Promise<CancelledReminders> {
  if (recipientIds.length === 0) return { cancelled: 0, discarded: 0, inFlight: 0 }
  const live = (await trx(REMINDERS)
    .whereIn('recipientId', recipientIds as number[])
    .whereIn('status', ['proposed', 'scheduled', 'claimed'])
    .orderBy('id')
    .forUpdate()
    .select('id', 'agencyId', 'userId', 'recipientId', 'status', 'proposalActionId')) as Record<string, unknown>[]
  const inFlight = (await trx(REMINDERS)
    .whereIn('recipientId', recipientIds as number[])
    .where({ status: 'dispatching' })
    .count<{ n: string }[]>('* as n')) as { n: string }[]

  const now = new Date()
  const toCancel = live.filter((r) => r.status !== 'proposed').map((r) => Number(r.id))
  const toDiscard = live.filter((r) => r.status === 'proposed')
  if (toCancel.length) {
    await trx(REMINDERS)
      .whereIn('id', toCancel)
      .whereIn('status', ['scheduled', 'claimed'])
      .update({ status: 'cancelled', cancelReason: reason, cancelledAt: now, finalizedAt: now, updatedAt: trx.fn.now() })
  }
  if (toDiscard.length) {
    await trx(REMINDERS)
      .whereIn('id', toDiscard.map((r) => Number(r.id)))
      .where({ status: 'proposed' })
      .update({ status: 'discarded', discardReason: 'consent', text: null, finalizedAt: now, updatedAt: trx.fn.now() })
    const actionIds = toDiscard.map((r) => r.proposalActionId as string | null).filter((a): a is string => !!a)
    if (actionIds.length) {
      await trx('wa_assistant_approvals')
        .whereIn('actionId', actionIds)
        .where({ status: 'pending' })
        .whereRaw(`"actionId" LIKE 'rem\\_%'`)
        .update({ status: 'expired', updatedAt: trx.fn.now() })
    }
  }
  await insertReminderEvents(
    trx,
    live.map((r) => ({
      agencyId: Number(r.agencyId),
      userId: Number(r.userId),
      recipientId: Number(r.recipientId),
      reminderId: Number(r.id),
      type: r.status === 'proposed' ? ('discarded' as const) : ('cancelled' as const),
      actorKind,
      fromStatus: String(r.status),
      toStatus: r.status === 'proposed' ? 'discarded' : 'cancelled',
      reason,
    })),
  )
  return { cancelled: toCancel.length, discarded: toDiscard.length, inFlight: Number(inFlight[0].n) }
}

function consentEvent(r: LockedRecipient, type: 'consent_granted' | 'consent_withdrawn', from: string, to: string) {
  return { agencyId: r.agencyId, userId: r.userId, recipientId: r.id, type, actorKind: 'settings', consentFrom: from, consentTo: to }
}

/** Settings opt-in. Only for an ACTIVE (verified) row. Never automatic. */
export async function grantPersonalRemindersConsent(agencyId: number, userId: number): Promise<'granted' | 'already' | 'not_active'> {
  return db.transaction(async (trx) => {
    const r = await lockOwnRecipient(trx, agencyId, userId)
    if (!r || r.status !== 'active') return 'not_active' as const
    if (consentCoversPersonalReminders(r.consentTextVersion)) return 'already' as const
    await recordConsent(trx, r.id, OWNER_WA_PERSONAL_REMINDERS_CONSENT.version)
    await trx('owner_personal_reminder_events').insert(consentEvent(r, 'consent_granted', r.consentTextVersion, OWNER_WA_PERSONAL_REMINDERS_CONSENT.version))
    return 'granted' as const
  })
}

export type WithdrawResult = ({ result: 'withdrawn' } & CancelledReminders) | { result: 'not_granted' }

/** Stop personal reminders only: v5 → v4; the assistant keeps working. */
export async function withdrawPersonalRemindersConsent(agencyId: number, userId: number): Promise<WithdrawResult> {
  return db.transaction(async (trx) => {
    const r = await lockOwnRecipient(trx, agencyId, userId)
    if (!r || !consentCoversPersonalReminders(r.consentTextVersion)) return { result: 'not_granted' as const }
    await recordConsent(trx, r.id, OWNER_WA_ASSISTANT_CONSENT.version)
    const cancelled = await cancelLiveReminders(trx, [r.id], 'consent_withdrawn', 'settings')
    await trx('owner_personal_reminder_events').insert(consentEvent(r, 'consent_withdrawn', r.consentTextVersion, OWNER_WA_ASSISTANT_CONSENT.version))
    return { result: 'withdrawn' as const, ...cancelled }
  })
}

/** Stop the assistant (and with it personal reminders): v3/v4/v5 → v2. Reminders about waiting leads stay on. */
export async function withdrawAssistantConsent(agencyId: number, userId: number): Promise<WithdrawResult> {
  return db.transaction(async (trx) => {
    const r = await lockOwnRecipient(trx, agencyId, userId)
    if (!r || !consentCoversAssistant(r.consentTextVersion)) return { result: 'not_granted' as const }
    await recordConsent(trx, r.id, OWNER_WA_CONSENT.version)
    const cancelled = await cancelLiveReminders(trx, [r.id], 'consent_withdrawn', 'settings')
    await trx('owner_personal_reminder_events').insert(consentEvent(r, 'consent_withdrawn', r.consentTextVersion, OWNER_WA_CONSENT.version))
    return { result: 'withdrawn' as const, ...cancelled }
  })
}
