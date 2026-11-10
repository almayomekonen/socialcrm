import { db } from '@/config/db'
import { maskPhone } from '@/lib/inbox/autoresponse/waTrace'
import { isWhatsappStatusEvent, statusRank, type WhatsappStatusEvent } from '@/lib/inbox/messageStatus'
import { isCloudApiWamid } from '@/lib/inbox/wamidFormat'
import { mapWhatsappError } from '@/lib/inbox/whatsappErrorCopy'
import { onQuoteDeliveryReceipt } from '@/lib/waAssistant/quotes/deliveryStatus'

/**
 * Process WhatsApp `statuses` webhook events onto existing outbound messages.
 *
 * Matching is on the wamid already stored in `inbox_messages.externalId`. The
 * ladder guard lives in the SQL WHERE clause, not here, so two concurrent
 * webhook deliveries cannot race a read-then-write.
 *
 * This function NEVER throws (the webhook must always answer 200 or Meta will
 * retry and can disable the subscription) and NEVER inserts (a status for an
 * unknown wamid is a diagnostic, not a message).
 *
 * An event that does not apply is classified by WHY, and the severity follows:
 *
 *   duplicate_same_status   expected  the row already holds this status
 *   coexistence_echo_status expected  a business-app message we never stored
 *   terminal_or_stale       warning   a transition genuinely rejected
 *   foreign_agency          warning   the id belongs to another tenant
 *   unknown_wamid           warning   a CLOUD API id with no row — the real signal
 *
 * The two expected reasons are the overwhelming majority of production volume.
 * Logging them at `warn` is what made an idempotent no-op indistinguishable from
 * data loss, and would bury a genuinely lost event if one ever occurred.
 */

type RawStatus = {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
  errors?: { code?: number }[]
}

const TIMESTAMP_KEY: Record<WhatsappStatusEvent, string> = {
  sent: 'sentAt',
  delivered: 'deliveredAt',
  read: 'readAt',
  failed: 'failedAt',
}

/** Meta sends unix seconds. Fall back to server time rather than losing the event. */
function resolveTimestamp(raw: unknown): { iso: string; malformed: boolean } {
  const secs = Number(raw)
  if (Number.isFinite(secs) && secs > 0) return { iso: new Date(secs * 1000).toISOString(), malformed: false }
  return { iso: new Date().toISOString(), malformed: true }
}

function warn(reason: string, ctx: Record<string, unknown>): void {
  // Never log message content — counts/ids/timing only.
  console.warn('[WhatsappWebhook][status] event not applied', { reason, ...ctx })
}

/**
 * Same line, same shape, lower severity — for outcomes that are EXPECTED.
 *
 * Two of the four not-applied reasons are routine and high volume. Logging them
 * at `warn` alongside real losses is what made a benign duplicate read as data
 * loss in the logs, and buries the one signal that would matter.
 */
function note(reason: string, ctx: Record<string, unknown>): void {
  console.log('[WhatsappWebhook][status] event not applied', { reason, ...ctx })
}

async function applyOne(agencyId: number, phoneNumberId: string, raw: RawStatus): Promise<void> {
  const wamid = raw?.id
  const status = raw?.status
  if (!wamid || !isWhatsappStatusEvent(status)) return

  const { iso, malformed } = resolveTimestamp(raw.timestamp)
  const errorCode = raw.errors?.[0]?.code ?? null
  const base = {
    wamid,
    phoneNumberId,
    agencyId,
    status,
    metaTimestamp: raw.timestamp ?? null,
    recipientId: maskPhone(raw.recipient_id),
    errorCode,
  }

  await onQuoteDeliveryReceipt({ agencyId, wamid, status, code: errorCode == null ? null : String(errorCode) })

  const patch: Record<string, unknown> = {
    [TIMESTAMP_KEY[status]]: iso,
    lastStatusChangeAt: iso,
  }
  if (status === 'failed') {
    const { category } = mapWhatsappError(errorCode)
    patch.errorCode = errorCode
    patch.category = category
  }

  const updated = await db('inbox_messages')
    .where({ channel: 'whatsapp', externalId: wamid, agencyId, direction: 'outbound' })
    // Excludes inbound `received` and both terminal states in one predicate.
    .whereIn('status', ['sent', 'delivered'])
    .whereRaw(`CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 ELSE 0 END < ?`, [statusRank(status)])
    .update({
      status,
      ...(status === 'failed' ? { errorReason: mapWhatsappError(errorCode).category } : {}),
      // `||` alone is a SHALLOW merge and would replace the whole delivery object,
      // wiping earlier timestamps. jsonb_set + nested || deep-merges one level.
      metadata: db.raw(
        `jsonb_set(COALESCE(metadata, '{}'::jsonb), '{delivery}', COALESCE(metadata->'delivery', '{}'::jsonb) || ?::jsonb, true)`,
        [JSON.stringify(patch)],
      ),
    })

  if (Number(updated) > 0) {
    if (malformed) warn('malformed_timestamp', base)
    return
  }

  // Zero rows has four very different causes. Without the discriminator all four
  // read as data loss in the logs — and two of them are entirely routine.
  const existing = await db('inbox_messages')
    .where({ channel: 'whatsapp', externalId: wamid })
    .first('id', 'agencyId', 'status')

  if (!existing) {
    // No row for this id. For a Coexistence business that is expected: Meta
    // reports delivery for messages sent from their own phone, and those are
    // acknowledged without being stored. Only an unmatched CLOUD API id means a
    // status for a message we really should have — that one stays a warning.
    if (isCloudApiWamid(wamid)) warn('unknown_wamid', { ...base, currentStatus: null })
    else note('coexistence_echo_status', { ...base, currentStatus: null })
    return
  }

  if (Number(existing.agencyId) !== agencyId) {
    warn('foreign_agency', { ...base, currentStatus: existing.status })
    return
  }

  // Already at the status being reported. Meta redelivers, and our own send flow
  // writes `sent` before Meta's `sent` webhook lands, so this is the single most
  // common outcome — 101 of 101 outbound messages in production. Re-arriving at
  // the status we already hold changes nothing; the strict `<` rank guard above
  // is exactly what makes it a no-op, and it stays strict.
  if (existing.status === status) {
    note('duplicate_same_status', { ...base, currentStatus: existing.status })
    return
  }

  // A transition that was genuinely rejected: the row is terminal (read/failed),
  // or this event is older than where the row already is. Still a warning.
  warn('terminal_or_stale', { ...base, currentStatus: existing.status })
}

/** `errored` counts entries whose write threw: the durable worker retries those. */
export type StatusIngestResult = { applied: number; errored: number; noConnection: boolean }

export async function ingestWhatsappStatuses(
  phoneNumberId: string | undefined,
  statuses: unknown[],
): Promise<StatusIngestResult> {
  if (!phoneNumberId) {
    warn('no_connection', { phoneNumberId: null, count: statuses.length })
    return { applied: 0, errored: 0, noConnection: true }
  }

  const connection = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first('agency_id')
  if (!connection) {
    warn('no_connection', { phoneNumberId, count: statuses.length })
    return { applied: 0, errored: 0, noConnection: true }
  }
  const agencyId = Number(connection.agency_id)

  // One bad entry must not drop the rest of the batch.
  let applied = 0
  let errored = 0
  for (const raw of statuses) {
    try {
      await applyOne(agencyId, phoneNumberId, raw as RawStatus)
      applied++
    } catch (err) {
      errored++
      console.error('[WhatsappWebhook][status] entry failed', {
        phoneNumberId,
        agencyId,
        error: String(err),
      })
    }
  }
  return { applied, errored, noConnection: false }
}
