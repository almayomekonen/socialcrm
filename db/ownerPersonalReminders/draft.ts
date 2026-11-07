import type { Knex } from 'knex'
import { db } from '@/config/db'
import { WA_APPROVAL_TTL_MS } from '@/db/waAssistantApprovals'
import { consentCoversPersonalReminders } from '@/lib/whatsapp/platform/consentText'
import { reminderActionId } from '@/lib/reminders/limits'
import { insertReminderEvents } from './events'
import { enforceReminderLimits, lockOwnedReminder, recordFounderWaiver } from './lock'

/**
 * T0, the draft a personal-reminder card is shown for (architecture v1.4–v1.6),
 * and T5′, discarding it when the card is rejected.
 *
 * NOTHING IS SCHEDULED HERE. A draft is `proposed`: no worker claims it, and it
 * becomes a reminder only when the owner taps "approve" (T5, ./schedule.ts).
 *
 * ONE REQUEST, ONE ROW, FOR LIFE. `(recipientId, sourceWamid)` is unique, so a
 * re-run of the same owner message finds its own row instead of drafting again:
 *   proposed                     → reused (same action id, same card)
 *   scheduled … sent             → "already scheduled", no card
 *   discarded / cancelled / …    → "already handled", no card
 *
 * Under the recipient lock (L1), the order every consent change uses: consent v5
 * and an active recipient of THIS owner, then the approved limits, then the
 * recipient's earlier drafts are superseded (one live draft per recipient).
 */

const T = 'owner_personal_reminders'

export type DraftOutcome =
  | { kind: 'draft'; reminderId: number; version: number; remindAtMs: number; actionId: string; reused: boolean }
  | { kind: 'already_scheduled'; remindAtMs: number }
  | { kind: 'handled' }
  | { kind: 'consent' }
  | { kind: 'limit'; reason: 'scheduled_limit' | 'daily_limit' }

export async function createReminderDraft(input: {
  owner: { agencyId: number; userId: number }
  recipientId: number
  text: string
  remindAtMs: number
  anchorSec: number
  sourceWamid: string
  sourceJobId: number
  nowMs: number
}): Promise<DraftOutcome> {
  return db.transaction(async (trx) => {
    const rec = (await trx('owner_whatsapp_recipients')
      .where({ id: input.recipientId, agencyId: input.owner.agencyId, userId: input.owner.userId })
      .forUpdate()
      .first('status', 'consentTextVersion')) as { status: string; consentTextVersion: string } | undefined
    if (!rec || rec.status !== 'active' || !consentCoversPersonalReminders(rec.consentTextVersion)) return { kind: 'consent' as const }

    const existing = (await trx(T)
      .where({ recipientId: input.recipientId, sourceWamid: input.sourceWamid })
      .forUpdate()
      .first('id', 'status', 'version', 'remindAt', 'proposalActionId')) as Record<string, unknown> | undefined
    if (existing) {
      const remindAtMs = new Date(existing.remindAt as string).getTime()
      if (existing.status === 'proposed') {
        return { kind: 'draft' as const, reminderId: Number(existing.id), version: Number(existing.version), remindAtMs, actionId: String(existing.proposalActionId), reused: true }
      }
      if (['scheduled', 'claimed', 'dispatching', 'sent'].includes(String(existing.status))) return { kind: 'already_scheduled' as const, remindAtMs }
      return { kind: 'handled' as const }
    }

    const limits = await enforceReminderLimits(trx, { id: 0, agencyId: input.owner.agencyId, userId: input.owner.userId, recipientId: input.recipientId }, input.remindAtMs)
    if (limits.breach) return { kind: 'limit' as const, reason: limits.breach }

    const now = new Date(input.nowMs)
    await supersedeDrafts(trx, input, now)
    const { rows } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('${T}', 'id')) AS id`)
    const id = Number(rows[0].id)
    const actionId = reminderActionId('create', id, 1)
    await trx(T).insert({
      id,
      agencyId: input.owner.agencyId,
      userId: input.owner.userId,
      recipientId: input.recipientId,
      text: input.text,
      textLength: [...input.text].length,
      remindAt: new Date(input.remindAtMs),
      anchorMessageTs: input.anchorSec,
      sourceWamid: input.sourceWamid,
      sourceJobId: input.sourceJobId,
      status: 'proposed',
      draftExpiresAt: new Date(input.nowMs + WA_APPROVAL_TTL_MS),
      proposalActionId: actionId,
    })
    await insertReminderEvents(trx, [
      { agencyId: input.owner.agencyId, userId: input.owner.userId, recipientId: input.recipientId, reminderId: id, type: 'proposed', actorKind: 'owner', actionId, toStatus: 'proposed' },
    ])
    if (limits.waived) await recordFounderWaiver(trx, { agencyId: input.owner.agencyId, userId: input.owner.userId, recipientId: input.recipientId }, id, limits.waived, actionId)
    return { kind: 'draft' as const, reminderId: id, version: 1, remindAtMs: input.remindAtMs, actionId, reused: false }
  })
}

async function supersedeDrafts(trx: Knex.Transaction, input: { owner: { agencyId: number; userId: number }; recipientId: number }, now: Date) {
  const old = (await trx(T).where({ recipientId: input.recipientId, status: 'proposed' }).orderBy('id').forUpdate().select('id')) as { id: number }[]
  if (!old.length) return
  const ids = old.map((r) => Number(r.id))
  await trx(T).whereIn('id', ids).where({ status: 'proposed' }).update({ status: 'discarded', discardReason: 'superseded', text: null, finalizedAt: now, updatedAt: trx.fn.now() })
  await insertReminderEvents(
    trx,
    ids.map((id) => ({ agencyId: input.owner.agencyId, userId: input.owner.userId, recipientId: input.recipientId, reminderId: id, type: 'superseded' as const, actorKind: 'system' as const, fromStatus: 'proposed', toStatus: 'discarded', reason: 'superseded' })),
  )
}

/** T5′: the owner rejected the card. Only a still-`proposed` draft of THIS owner is discarded. */
export async function discardRejectedDraft(input: { reminderId: number; owner: { agencyId: number; userId: number }; actionId: string; nowMs: number }): Promise<boolean> {
  return db.transaction(async (trx) => {
    const r = await lockOwnedReminder(trx, input.reminderId, input.owner)
    if (!r || r.status !== 'proposed') return false
    const now = new Date(input.nowMs)
    await trx(T).where({ id: r.id, status: 'proposed' }).update({ status: 'discarded', discardReason: 'rejected', text: null, finalizedAt: now, updatedAt: trx.fn.now() })
    await insertReminderEvents(trx, [
      { agencyId: r.agencyId, userId: r.userId, recipientId: r.recipientId, reminderId: r.id, type: 'discarded', actorKind: 'owner', actionId: input.actionId, fromStatus: 'proposed', toStatus: 'discarded', reason: 'rejected' },
    ])
    return true
  })
}

export type ReminderView = { id: number; status: string; version: number; text: string | null; remindAtMs: number; updatedAtMs: number }

const view = (r: Record<string, unknown>): ReminderView => ({
  id: Number(r.id),
  status: String(r.status),
  version: Number(r.version),
  text: (r.text as string | null) ?? null,
  remindAtMs: new Date(r.remindAt as string).getTime(),
  updatedAtMs: new Date(r.updatedAt as string).getTime(),
})

/** The owner's upcoming reminders (scheduled or claimed), soonest first. Agency AND user scoped. */
export async function listUpcomingReminders(owner: { agencyId: number; userId: number }, limit = 10): Promise<ReminderView[]> {
  const rows = (await db(T)
    .where({ agencyId: owner.agencyId, userId: owner.userId })
    .whereIn('status', ['scheduled', 'claimed'])
    .orderBy([{ column: 'remindAt' }, { column: 'id' }])
    .limit(limit)
    .select('id', 'status', 'version', 'text', 'remindAt', 'updatedAt')) as Record<string, unknown>[]
  return rows.map(view)
}

/** One reminder of this owner, any status, for the reply after a decision. */
export async function readOwnReminder(owner: { agencyId: number; userId: number }, id: number): Promise<ReminderView | null> {
  const row = (await db(T).where({ id, agencyId: owner.agencyId, userId: owner.userId }).first('id', 'status', 'version', 'text', 'remindAt', 'updatedAt')) as Record<string, unknown> | undefined
  return row ? view(row) : null
}
