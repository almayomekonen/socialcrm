import { db } from '@/config/db'
import { activateByCode, optOutByPhone } from '@/db/ownerWhatsappRecipients'
import {
  countRecentRejectedActivations,
  hasOptOutAtOrAfter,
  recordPlatformInbound,
  setPlatformInboundKind,
} from '@/db/platformWhatsappInbound'
import { ownerWhatsappReminderAgencyIds } from '@/lib/flags/ownerWhatsappReminderFlags'
import { parsePlatformStatus, recordPlatformStatus } from '@/db/platformWhatsappMessageStatus'
import { parsePlatformCommand } from './commands'
import { hashActivationCode, hashPlatformSender } from './keys'

/**
 * Inbound traffic to the SocialCRM platform number (not an agency's number).
 *
 * NEVER enters the agency pipeline: no conversation, message, lead, bot, job or
 * notification is created, and nothing is sent (this module makes no network
 * call). Delivery statuses are recorded by message id for the owner reminders
 * this number sends (`owner_whatsapp_message_status`, forward-only); every other
 * non-message field is ignored.
 *
 * ONE TRANSACTION PER MESSAGE, under a per-sender advisory lock:
 *   1. record the message id (a redelivery stops here, changing nothing);
 *   2. an opt-out updates the recipients in the same transaction;
 *   3. an activation is checked against the rate limit and any later opt-out,
 *      then consumes its code in one guarded statement.
 * A failure rolls the whole message back, including step 1, so a redelivery
 * processes it again. The caller decides what to answer Meta.
 */

/** Advisory-lock namespace (int4), distinct from 12345 and 20261118..20261120. */
export const PLATFORM_SENDER_LOCK_NAMESPACE = 20261012
export const MAX_REJECTED_ACTIVATIONS_PER_HOUR = 5

export type PlatformMessageOutcome =
  | 'duplicate'
  | 'opted_out'
  | 'activated'
  | 'activation_rejected'
  | 'ignored'
  | 'skipped'

type Change = { field?: unknown; value?: { messages?: unknown; statuses?: unknown } & Record<string, unknown> }

const phoneDigits = (raw: unknown): string | null => (typeof raw === 'string' && /^[1-9]\d{7,14}$/.test(raw) ? raw : null)

function sentAt(raw: unknown): number | null {
  const n = typeof raw === 'string' && /^\d{1,12}$/.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function processPlatformMessage(message: Record<string, any>): Promise<PlatformMessageOutcome> {
  const wamid = typeof message?.id === 'string' && message.id ? message.id : null
  if (!wamid) return 'skipped'

  const from = phoneDigits(message.from)
  const timestamp = sentAt(message.timestamp)
  const parsed = message.type === 'text' ? parsePlatformCommand(message.text?.body) : ({ kind: 'other' } as const)
  // Without a number there is nobody to opt out or bind; without Meta's send
  // time an activation cannot be ordered against an opt-out. An opt-out with no
  // send time is still honoured, as of now.
  const command = !from || (parsed.kind === 'activation' && timestamp === null) ? ({ kind: 'other' } as const) : parsed
  const messageTimestamp = timestamp ?? Math.floor(Date.now() / 1000)
  const fromHash = from ? hashPlatformSender(from) : null

  return db.transaction(async (trx) => {
    if (fromHash) {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [fromHash, PLATFORM_SENDER_LOCK_NAMESPACE])
    }
    const isNew = await recordPlatformInbound(trx, { wamid, kind: command.kind, fromHash, messageTimestamp })
    if (!isNew) return 'duplicate'

    if (command.kind === 'opt_out') {
      await optOutByPhone(trx, `+${from}`, messageTimestamp)
      return 'opted_out'
    }
    if (command.kind !== 'activation' || !fromHash) return 'ignored'

    const rejected =
      (await countRecentRejectedActivations(trx, fromHash)) >= MAX_REJECTED_ACTIVATIONS_PER_HOUR ||
      (await hasOptOutAtOrAfter(trx, fromHash, messageTimestamp)) ||
      !(await activateByCode(trx, {
        codeHash: hashActivationCode(command.code),
        phoneE164: `+${from}`,
        messageTimestamp,
        agencyIds: ownerWhatsappReminderAgencyIds(),
      }))
    if (!rejected) return 'activated'
    await setPlatformInboundKind(trx, wamid, 'activation_rejected')
    return 'activation_rejected'
  })
}

/**
 * Every message in every platform change. Each message is independent: one
 * failure does not stop the others. `ok` is false when any message could not be
 * persisted, so the caller can ask Meta to redeliver (a redelivery repeats only
 * what was not saved; what was saved is a no-op by message id).
 */
export async function processPlatformChanges(changes: Change[]): Promise<{ ok: boolean; failed: number; outcomes: PlatformMessageOutcome[] }> {
  const outcomes: PlatformMessageOutcome[] = []
  let failed = 0
  for (const change of changes) {
    if (change?.field !== 'messages') continue
    const statuses = Array.isArray(change.value?.statuses) ? (change.value.statuses as unknown[]) : []
    for (const raw of statuses) {
      const event = parsePlatformStatus(raw)
      if (!event) continue
      try {
        await recordPlatformStatus(event)
      } catch (err) {
        failed++
        console.error('[WhatsappWebhook][platform] status not saved', { code: (err as { code?: string })?.code ?? null })
      }
    }
    const messages = Array.isArray(change.value?.messages) ? (change.value.messages as Record<string, any>[]) : []
    for (const message of messages) {
      try {
        outcomes.push(await processPlatformMessage(message))
      } catch (err) {
        failed++
        console.error('[WhatsappWebhook][platform] message not saved', { code: (err as { code?: string })?.code ?? null })
      }
    }
  }
  return { ok: failed === 0, failed, outcomes }
}
