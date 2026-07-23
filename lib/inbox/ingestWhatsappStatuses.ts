import { db } from '@/config/db'
import { isWhatsappStatusEvent, statusRank, type WhatsappStatusEvent } from '@/lib/inbox/messageStatus'
import { mapWhatsappError } from '@/lib/inbox/whatsappErrorCopy'

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
    recipientId: raw.recipient_id ?? null,
    errorCode,
  }

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

  // Zero rows has three very different causes. Without the discriminator all
  // three read as data loss in the logs.
  const existing = await db('inbox_messages')
    .where({ channel: 'whatsapp', externalId: wamid })
    .first('id', 'agencyId', 'status')
  const reason = !existing
    ? 'unknown_wamid'
    : Number(existing.agencyId) !== agencyId
      ? 'foreign_agency'
      : 'terminal_or_stale'
  warn(reason, { ...base, currentStatus: existing?.status ?? null })
}

export async function ingestWhatsappStatuses(
  phoneNumberId: string | undefined,
  statuses: unknown[],
): Promise<void> {
  if (!phoneNumberId) {
    warn('no_connection', { phoneNumberId: null, count: statuses.length })
    return
  }

  const connection = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first('agency_id')
  if (!connection) {
    warn('no_connection', { phoneNumberId, count: statuses.length })
    return
  }
  const agencyId = Number(connection.agency_id)

  // One bad entry must not drop the rest of the batch.
  for (const raw of statuses) {
    try {
      await applyOne(agencyId, phoneNumberId, raw as RawStatus)
    } catch (err) {
      console.error('[WhatsappWebhook][status] entry failed', {
        phoneNumberId,
        agencyId,
        error: String(err),
      })
    }
  }
}
