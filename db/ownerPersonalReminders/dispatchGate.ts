import type { Knex } from 'knex'
import { db } from '@/config/db'
import { consentCoversPersonalReminders } from '@/lib/whatsapp/platform/consentText'
import { hashPlatformSender } from '@/lib/whatsapp/platform/keys'
import { MONITOR_STALE_MS, REMINDER_MAX_LATENESS_MS, REMINDER_WINDOW_MS } from '@/lib/flags/personalReminderFlags'
import { reminderMessage } from '@/lib/reminders/delivery/message'
import { insertReminderEvents, type ReminderEvent } from './events'
import { isPlatformSendingPaused, missingControls, readSendControls } from './controls'
import { findServiceRate, latestVerifiedInboundMs } from './rateCards'
import { FAILURE_FOR_SCOPE, reservationPlan, reserveAll, type ScopeKind } from './capacity'

/**
 * T2, the final send gate (architecture v1.2 A2, v1.6, v1.6.1). ONE short
 * transaction; no network call ever happens inside it.
 *
 *   1. read `recipientId` without a lock; lock the recipient (L1), then the
 *      reminder (L2): the order every consent change and opt-out uses;
 *   2. the reminder must still be `claimed` by THIS token;
 *   3. consent/opt-out, FAIL CLOSED: active recipient, same owner, consent v5,
 *      else CANCELLED;
 *   4. operational controls: DB kill switch on, not tripped, every control
 *      configured, heartbeat fresh, account not paused, else the claim is
 *      handed back (`deferred`): nothing was sent, the lateness cap still applies;
 *   5. more than 60 min late → FAILED `too_late`;
 *   6. Meta's window from VERIFIED inbound timestamps only: none → `unverified_window`;
 *      over 23 h → `window_closed`;
 *   7. measured exposure at or over the soft limit → `cap_platform_month`;
 *   8. the official rate (rate card, billing currency, freshness) → else `pricing_unavailable`;
 *   9. capacity (L3, fixed order) inside a savepoint: a full scope undoes the
 *      earlier increments → FAILED `cap_*`;
 *  10. `dispatching` + `dispatchedAt`. Committing this is the point of no return.
 */

const T = 'owner_personal_reminders'

export type GateResult =
  | { result: 'dispatching'; toE164: string; body: string; rateCardId: number; priceMicros: number }
  | { result: 'cancelled'; reason: 'opted_out' | 'recipient_inactive' | 'consent_withdrawn' }
  | { result: 'failed'; reason: string }
  | { result: 'deferred'; reason: string }
  | { result: 'not_claimed'; status: string | null }

type Row = { id: number; agencyId: number; userId: number; recipientId: number; text: string | null; remindAt: Date }

async function finish(trx: Knex.Transaction, r: Row, now: Date, patch: Record<string, unknown>, event: Record<string, unknown>) {
  await trx(T).where({ id: r.id, status: 'claimed' }).update({ ...patch, updatedAt: trx.fn.now() })
  await insertReminderEvents(trx, [
    { agencyId: r.agencyId, userId: r.userId, recipientId: r.recipientId, reminderId: r.id, actorKind: 'system', fromStatus: 'claimed', ...(event as Partial<ReminderEvent>) } as ReminderEvent,
  ])
}

export async function enterDispatch(input: { reminderId: number; claimToken: string; nowMs: number; exposure?: number | null }): Promise<GateResult> {
  return db.transaction(async (trx) => {
    const peek = (await trx(T).where({ id: input.reminderId }).first('recipientId')) as { recipientId: string | number } | undefined
    if (!peek) return { result: 'not_claimed' as const, status: null }
    const recipient = (await trx('owner_whatsapp_recipients')
      .where({ id: peek.recipientId })
      .forUpdate()
      .first('status', 'consentTextVersion', 'agencyId', 'userId', 'phoneE164')) as Record<string, unknown> | undefined
    const raw = (await trx(T)
      .where({ id: input.reminderId })
      .forUpdate()
      .first('id', 'agencyId', 'userId', 'recipientId', 'status', 'claimToken', 'text', 'remindAt')) as Record<string, unknown> | undefined
    if (!raw || raw.status !== 'claimed' || raw.claimToken !== input.claimToken) return { result: 'not_claimed' as const, status: (raw?.status as string) ?? null }
    const r: Row = { id: Number(raw.id), agencyId: Number(raw.agencyId), userId: Number(raw.userId), recipientId: Number(raw.recipientId), text: (raw.text as string | null) ?? null, remindAt: new Date(raw.remindAt as string) }
    const now = new Date(input.nowMs)

    // 3. Consent and opt-out.
    const sameOwner = !!recipient && Number(recipient.agencyId) === r.agencyId && Number(recipient.userId) === r.userId
    const cancel: 'opted_out' | 'recipient_inactive' | 'consent_withdrawn' | null =
      !recipient || !sameOwner ? 'recipient_inactive'
        : recipient.status === 'opted_out' ? 'opted_out'
          : recipient.status !== 'active' ? 'recipient_inactive'
            : !consentCoversPersonalReminders(recipient.consentTextVersion as string) ? 'consent_withdrawn'
              : null
    if (cancel) {
      await finish(trx, r, now, { status: 'cancelled', cancelReason: cancel, cancelledAt: now, finalizedAt: now }, { type: 'cancelled', toStatus: 'cancelled', reason: cancel })
      return { result: 'cancelled' as const, reason: cancel }
    }

    // 4. Operational controls: hand the claim back, unsent.
    const c = await readSendControls(trx)
    const heartbeatOk = !!c?.monitorLastRunAt && input.nowMs - c.monitorLastRunAt.getTime() <= MONITOR_STALE_MS
    const defer =
      !c || !c.remindersEnabled ? 'disabled'
        : c.trippedAt ? 'kill_switch'
          : missingControls(c).length ? 'unconfigured'
            : !heartbeatOk ? 'monitor_stale'
              : (await isPlatformSendingPaused(now, trx)) ? 'account_paused'
                : null
    // A deferral hands the claim back unsent; the attempt does not count.
    const handBack = async (reason: string) => {
      await trx(T).where({ id: r.id, status: 'claimed' }).update({ status: 'scheduled', claimToken: null, claimedAt: null, attempts: trx.raw('GREATEST(attempts - 1, 0)'), updatedAt: trx.fn.now() })
      return { result: 'deferred' as const, reason }
    }
    if (defer || !c) return handBack(defer ?? 'disabled')

    const fail = async (reason: string, event: Record<string, unknown> = {}) => {
      await finish(trx, r, now, { status: 'failed', failureReason: reason, finalizedAt: now }, { type: 'failed', toStatus: 'failed', reason, ...event })
      return { result: 'failed' as const, reason }
    }

    // 5. Lateness (approved: up to 60 minutes).
    if (input.nowMs - r.remindAt.getTime() > REMINDER_MAX_LATENESS_MS) return fail('too_late')

    // 6. Meta's 24-hour window, from verified Meta timestamps of this owner's messages.
    const phone = String(recipient!.phoneE164 ?? '')
    const latest = await latestVerifiedInboundMs(trx, hashPlatformSender(phone.replace(/\D/g, '')))
    if (latest === null) return fail('unverified_window')
    if (input.nowMs > latest + REMINDER_WINDOW_MS) return fail('window_closed')

    // 7. Measured platform exposure (best effort; the hard limits are the reservations below).
    if (input.exposure === null || input.exposure === undefined) return handBack('exposure_unknown')
    if (input.exposure >= (c.serviceSoftLimit as number)) return fail('cap_platform_month')

    // 8. The official rate.
    const rate = await findServiceRate(trx, { phoneE164: phone, currency: c.billingCurrency as string, billingTimezone: c.billingTimezone as string, maxAgeDays: c.pricingMaxAgeDays as number, nowMs: input.nowMs })
    if (!rate.ok) return fail('pricing_unavailable', { type: 'pricing_unavailable' })

    // 9. Capacity, all or nothing (a savepoint undoes partial increments).
    const plan = reservationPlan(c, r, input.nowMs, rate.unitPriceMicros)
    let denied: ScopeKind | null = null
    try {
      await trx.transaction(async (sp) => {
        denied = await reserveAll(sp, plan)
        if (denied) throw new Error('capacity_denied')
      })
    } catch (err) {
      if ((err as Error).message !== 'capacity_denied') throw err
    }
    if (denied) {
      const scope: ScopeKind = denied
      return fail(FAILURE_FOR_SCOPE[scope], { type: 'capacity_denied', capacityScope: ['platform', 'agency', 'recipient'].includes(scope) ? scope : null })
    }

    // 10. The point of no return.
    await trx(T)
      .where({ id: r.id, status: 'claimed' })
      .update({ status: 'dispatching', dispatchedAt: now, channel: 'text', rateCardId: rate.rateCardId, reservedMicros: rate.unitPriceMicros, costReleasedAt: null, updatedAt: trx.fn.now() })
    await insertReminderEvents(trx, [{ agencyId: r.agencyId, userId: r.userId, recipientId: r.recipientId, reminderId: r.id, actorKind: 'system', type: 'dispatched', fromStatus: 'claimed', toStatus: 'dispatching' }])
    return { result: 'dispatching' as const, toE164: phone, body: reminderMessage(r.text ?? '', r.remindAt.getTime(), input.nowMs), rateCardId: rate.rateCardId, priceMicros: rate.unitPriceMicros }
  })
}
