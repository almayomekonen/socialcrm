import { db } from '@/config/db'
import { lockAndRecheck, recordOutcome, type ClaimedDelivery } from '@/db/ownerWhatsappReminders/deliveries'
import { nextAllowedAfterQuietHours, withinQuietHours } from '@/lib/inbox/autoresponse/noResponseClose'
import { sendOwnerReminder } from '@/lib/whatsapp/platform/sendReminder'
import type { AgencyScope } from '@/db/ownerWhatsappReminders/candidates'
import { hasReminderProductAccess } from './productAccess'
import { RATE_LIMIT_BACKOFF_MS } from './constants'
import { waitingTimeHebrew } from './waitingTime'

type QuietHours = Parameters<typeof withinQuietHours>[0]

export type DeliveryResult = 'sent' | 'unknown' | 'failed' | 'retry' | 'cancelled' | 'deferred'

/**
 * Send one claimed delivery. Everything happens in ONE transaction holding the
 * conversation lock and the recipient row lock (see `lockAndRecheck`), so the
 * Graph call (bounded by an 8-second timeout) can never race an opt-out, a
 * second tick or a sibling send for the same conversation.
 */
export async function sendClaimedDelivery(input: {
  delivery: ClaimedDelivery
  agencyIds: AgencyScope
  quietHours: QuietHours
  phoneNumberId: string
  accessToken: string
  now: Date
}): Promise<DeliveryResult> {
  const { delivery: d, now } = input
  return db.transaction(async (trx) => {
    const check = await lockAndRecheck(trx, d, input.agencyIds, now)
    if (check.ok === false) {
      await recordOutcome(trx, d.id, { status: 'cancelled', cancelReason: check.reason })
      return 'cancelled'
    }
    // Product access, immediately before the send and failing closed: an
    // agency whose trial ended after scheduling is never reminded.
    if (!(await hasReminderProductAccess(d.agencyId, now))) {
      await recordOutcome(trx, d.id, { status: 'cancelled', cancelReason: 'agency_no_access' })
      return 'cancelled'
    }
    if (withinQuietHours(input.quietHours, now)) {
      // Nothing was sent: hand the delivery back for after the quiet window.
      await recordOutcome(trx, d.id, { status: 'scheduled', nextAttemptAt: nextAllowedAfterQuietHours(input.quietHours, now), errorCode: null, errorScope: null })
      return 'deferred'
    }
    const outcome = await sendOwnerReminder({
      phoneNumberId: input.phoneNumberId,
      accessToken: input.accessToken,
      toE164: check.recipient.phoneE164,
      waitingText: waitingTimeHebrew(d.escalatedAt, now),
      conversationId: d.conversationId,
      deliveryId: d.id,
    })
    if (outcome.kind === 'sent') {
      await recordOutcome(trx, d.id, { status: 'sent', wamid: outcome.wamid })
      return 'sent'
    }
    if (outcome.kind === 'unknown') {
      await recordOutcome(trx, d.id, { status: 'unknown', errorCode: outcome.reason })
      return 'unknown'
    }
    if (outcome.scope === 'rate_limit' && d.attempts <= RATE_LIMIT_BACKOFF_MS.length) {
      const wait = RATE_LIMIT_BACKOFF_MS[d.attempts - 1] ?? RATE_LIMIT_BACKOFF_MS[RATE_LIMIT_BACKOFF_MS.length - 1]
      await recordOutcome(trx, d.id, { status: 'scheduled', nextAttemptAt: new Date(now.getTime() + wait), errorCode: outcome.code, errorScope: 'rate_limit' })
      return 'retry'
    }
    await recordOutcome(trx, d.id, { status: 'failed', errorCode: outcome.code, errorScope: outcome.scope })
    return 'failed'
  })
}
