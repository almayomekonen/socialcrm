import { db } from '@/config/db'
import { notifyEvent } from '@/lib/notifications/emit'

/**
 * Meta's `account_update` webhook: account-level lifecycle of a customer's
 * WhatsApp (Messaging) account.
 *
 * What SocialCRM does with it is deliberately small:
 *   PARTNER_REMOVED, ACCOUNT_OFFBOARDED, ACCOUNT_DELETED
 *     → the matching connections are marked `disconnected` (the same state the
 *       hourly health sweep uses), and `integration.disconnected` is emitted
 *       once per connection, only on the transition.
 *   ACCOUNT_RECONNECTED
 *     → a connection marked `disconnected` goes back to `unknown`; the sweep then
 *       re-verifies it live. A reconnect is never reported as healthy here.
 *   anything else → logged (event name only) and acknowledged.
 *
 * NEVER deletes a connection or any customer data, and never registers or
 * deregisters a number: the row stays, so a reconnect through Embedded Signup
 * updates it (and an existing Coexistence connection keeps its type).
 *
 * Idempotent: the update only touches rows not already in the target state, so
 * a duplicate or concurrent delivery changes nothing and notifies nothing.
 *
 * The account id: partner events carry `waba_info.waba_id` (Meta's own example
 * shows an `entry.id` that differs from it), so it wins; otherwise `entry.id`.
 * Only rows whose `waba_id` equals it are touched; the platform number's
 * account is not in `whatsapp_connections`, so it is never affected.
 */

const DISCONNECTING = new Set(['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED', 'ACCOUNT_DELETED'])
const RECONNECTING = 'ACCOUNT_RECONNECTED'
const ENUM = /^[A-Z][A-Z0-9_]{0,63}$/
const ACCOUNT_ID = /^\d{1,32}$/

export type AccountUpdateOutcome =
  | { action: 'disconnected'; matched: number; transitioned: number }
  | { action: 'reconnected'; matched: number; reset: number }
  | { action: 'ignored'; reason: 'no_account_id' | 'unhandled_event' | 'invalid_event' }

/** Enum-like strings only, so nothing Meta sends can put free text into logs. */
const asEnum = (v: unknown): string | null => (typeof v === 'string' && ENUM.test(v) ? v : null)

export async function processAccountUpdate(entryId: unknown, value: unknown): Promise<AccountUpdateOutcome> {
  const v = (value && typeof value === 'object' ? value : {}) as {
    event?: unknown
    waba_info?: { waba_id?: unknown }
    disconnection_info?: { reason?: unknown; initiated_by?: unknown }
  }
  const event = asEnum(v.event)
  if (!event) {
    console.warn('[WA AccountUpdate] event missing or malformed; acknowledged')
    return { action: 'ignored', reason: 'invalid_event' }
  }
  if (!DISCONNECTING.has(event) && event !== RECONNECTING) {
    console.log('[WA AccountUpdate] event not handled; acknowledged', { event })
    return { action: 'ignored', reason: 'unhandled_event' }
  }

  const raw = v.waba_info?.waba_id ?? entryId
  const wabaId = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : ''
  if (!ACCOUNT_ID.test(wabaId)) {
    console.warn('[WA AccountUpdate] no usable account id; acknowledged', { event })
    return { action: 'ignored', reason: 'no_account_id' }
  }

  const matched = Number(
    ((await db('whatsapp_connections').where({ waba_id: wabaId }).count({ n: '*' })) as { n: string | number }[])[0]?.n ?? 0,
  )

  if (event === RECONNECTING) {
    const reset = await db('whatsapp_connections')
      .where({ waba_id: wabaId, health_status: 'disconnected' })
      .update({ health_status: 'unknown', health_checked_at: new Date() })
    console.log('[WA AccountUpdate] reconnected; awaiting the health sweep', { event, wabaId, matched, reset })
    return { action: 'reconnected', matched, reset: Number(reset) }
  }

  const changed = (await db('whatsapp_connections')
    .where({ waba_id: wabaId })
    .whereNot({ health_status: 'disconnected' })
    .update({ health_status: 'disconnected', health_checked_at: new Date() })
    .returning(['id', 'agency_id'])) as { id: number; agency_id: number }[]

  console.warn('[WA AccountUpdate] account disconnected by Meta; connection kept, marked disconnected', {
    event,
    wabaId,
    matched,
    transitioned: changed.length,
    reason: asEnum(v.disconnection_info?.reason),
    initiatedBy: asEnum(v.disconnection_info?.initiated_by),
  })

  for (const row of changed) {
    const at = new Date()
    await notifyEvent({
      type: 'integration.disconnected',
      agencyId: row.agency_id,
      entityType: 'integration',
      entityId: row.id,
      actorUserId: null,
      occurredAt: at,
      payload: { provider: 'whatsapp', disconnectedAt: at.getTime() },
    }).catch((err) => console.error('[WA AccountUpdate] notification failed', { error: String(err) }))
  }
  return { action: 'disconnected', matched, transitioned: changed.length }
}
