import { db } from '@/config/db'
import { quietHoursByAgency } from '@/db/notifications/unanswered'
import { claimOneOffDelivery, recheckBeforeSend, type OneOffRefusal } from '@/db/ownerWhatsappReminders/oneOff'
import { finalizeReminders, recordOutcome } from '@/db/ownerWhatsappReminders/deliveries'
import { withinQuietHours } from '@/lib/inbox/autoresponse/noResponseClose'
import {
  ownerWhatsappOneOffRecipientId,
  ownerWhatsappReminderAgencyIds,
  platformWhatsappAccessToken,
  platformWhatsappPhoneNumberId,
} from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendOwnerReminder } from '@/lib/whatsapp/platform/sendReminder'
import { ONE_OFF_IMMEDIATE_DELAY_MS, REMINDER_DELAY_MS } from './constants'
import { waitingTimeHebrew, waitingTimeHebrewWithMinutes } from './waitingTime'

/**
 * ONE real owner reminder, on request, for a test: agency 103 only, to the one
 * recipient row named by OWNER_WA_ONE_OFF_RECIPIENT_ID, about one real,
 * currently eligible hand-off. Same template, payload, sender and delivery
 * rows as the cron; OWNER_WA_REMINDERS_SEND_ENABLED is never read.
 *
 *   1. configuration and quiet hours (nothing written on refusal);
 *   2. claim: one short transaction (db/ownerWhatsappReminders/oneOff.ts), the
 *      delivery is written as `sending` and committed;
 *   3. fresh consent and eligibility read, then exactly one Meta request with
 *      NO transaction open;
 *   4. the outcome via the guarded `recordOutcome`. Never retried: a timeout,
 *      network error or 5xx is `unknown`, a rate limit is `failed`.
 *
 * Mode `standard` uses the cron's 120-minute minimum wait. Mode `immediate`
 * (test only) accepts a hand-off waiting 1 minute and states the wait exactly,
 * in minutes ("5 דקות"), in the same approved template's {{1}}. Every other
 * rule is the same in both modes; the cron's own threshold never changes.
 *
 * Residual race: an opt-out committed after step 3's read and before Meta
 * receives the request (at most the 8-second request bound, in practice
 * milliseconds) cannot stop this single send. The cron closes that window by
 * holding the recipient row lock during the request; this path does not hold a
 * transaction across network I/O by design.
 */

export const ONE_OFF_AGENCY_ID = 103

export type OneOffConfigRefusal = 'not_configured' | 'agency_not_allowlisted' | 'platform_not_configured' | 'quiet_hours'

export type OneOffResult =
  | { outcome: 'refused'; reason: OneOffConfigRefusal | OneOffRefusal }
  | { outcome: 'cancelled'; deliveryId: number; reason: string }
  | { outcome: 'sent'; deliveryId: number; wamid: string }
  | { outcome: 'unknown'; deliveryId: number; reason: string }
  | { outcome: 'failed'; deliveryId: number; scope: string; code: string | null }

export type OneOffMode = 'standard' | 'immediate'

export async function sendOneOffReminder(
  input: { conversationId: number; mode?: OneOffMode; now?: Date },
  deps: { send: typeof sendOwnerReminder } = { send: sendOwnerReminder },
): Promise<OneOffResult> {
  const now = input.now ?? new Date()
  const immediate = input.mode === 'immediate'
  const delayMs = immediate ? ONE_OFF_IMMEDIATE_DELAY_MS : REMINDER_DELAY_MS
  const agencyId = ONE_OFF_AGENCY_ID
  const recipientId = ownerWhatsappOneOffRecipientId()
  if (!recipientId) return { outcome: 'refused', reason: 'not_configured' }
  const agencyIds = ownerWhatsappReminderAgencyIds()
  if (!agencyIds.includes(agencyId)) return { outcome: 'refused', reason: 'agency_not_allowlisted' }
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const accessToken = platformWhatsappAccessToken()
  if (!phoneNumberId || !accessToken) return { outcome: 'refused', reason: 'platform_not_configured' }
  if (withinQuietHours((await quietHoursByAgency([agencyId])).get(agencyId), now)) return { outcome: 'refused', reason: 'quiet_hours' }

  const claimed = await claimOneOffDelivery({ recipientId, agencyId, conversationId: input.conversationId, agencyIds, delayMs, now })
  if (claimed.ok === false) return { outcome: 'refused', reason: claimed.reason }
  const { claim } = claimed
  const deliveryId = claim.deliveryId

  const fresh = await recheckBeforeSend({ recipientId, agencyId, conversationId: input.conversationId, claim, agencyIds, delayMs, now })
  if (fresh.ok === false) {
    await recordOutcome(db, deliveryId, { status: 'cancelled', cancelReason: fresh.reason })
    await finalizeReminders()
    return { outcome: 'cancelled', deliveryId, reason: fresh.reason }
  }

  const sent = await deps.send({
    phoneNumberId,
    accessToken,
    toE164: fresh.phoneE164,
    waitingText: immediate ? waitingTimeHebrewWithMinutes(claim.escalatedAt, now) : waitingTimeHebrew(claim.escalatedAt, now),
    conversationId: input.conversationId,
    deliveryId,
  })

  let result: OneOffResult
  if (sent.kind === 'sent') {
    await recordOutcome(db, deliveryId, { status: 'sent', wamid: sent.wamid })
    result = { outcome: 'sent', deliveryId, wamid: sent.wamid }
  } else if (sent.kind === 'unknown') {
    await recordOutcome(db, deliveryId, { status: 'unknown', errorCode: sent.reason })
    result = { outcome: 'unknown', deliveryId, reason: sent.reason }
  } else {
    // A rate limit is final here too: a one-off is never rescheduled.
    await recordOutcome(db, deliveryId, { status: 'failed', errorCode: sent.code, errorScope: sent.scope })
    result = { outcome: 'failed', deliveryId, scope: sent.scope, code: sent.code }
  }
  await finalizeReminders()
  return result
}
