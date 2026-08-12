/**
 * Facebook → notification emission boundaries for integration health.
 *
 * Disconnected: only on a real transition into `token_expired`, so polling and
 * Meta retries that re-observe an already-expired token stay quiet.
 * Ingestion failed: only when a leadgen webhook could not persist the lead
 * (non-auth failures). Auth failures are disconnect, not ingestion_failed.
 *
 * Recovery does not auto-resolve here: registry entries have no `isResolved`
 * (P1 scope). Collapse + transition guards absorb spam without inventing
 * escalation predicates.
 */

import { db } from '@/config/db'
import { notifyEvent } from '@/lib/notifications/emit'

export type FacebookPageConnection = {
  id: number
  agency_id: number
  page_id: string
}

/**
 * Atomically mark the page token expired and enqueue integration.disconnected
 * only when the row was not already expired.
 */
export async function markFacebookDisconnectedAndNotify(
  connection: FacebookPageConnection,
): Promise<'emitted' | 'already_disconnected'> {
  const at = new Date()
  const updated = await db('facebook_pages')
    .where({ id: connection.id })
    .whereNot({ health_status: 'token_expired' })
    .update({ health_status: 'token_expired', health_checked_at: at })

  if (!updated) return 'already_disconnected'

  await notifyEvent({
    type: 'integration.disconnected',
    agencyId: connection.agency_id,
    entityType: 'integration',
    entityId: connection.id,
    actorUserId: null,
    occurredAt: at,
    payload: {
      provider: 'facebook',
      disconnectedAt: at.getTime(),
    },
  })

  return 'emitted'
}

/**
 * A Meta leadgen delivery that could not be persisted (fetch/timeout/graph/db/
 * unhandled). Token expiry is handled by markFacebookDisconnectedAndNotify.
 *
 * Identity is the Meta leadgen id so webhook retries collapse; distinct leads
 * remain distinct jobs (bell collapse still merges open rows per provider).
 */
export async function notifyFacebookIngestionFailed(
  connection: FacebookPageConnection,
  metaLeadId: string,
): Promise<void> {
  const externalLeadId = metaLeadId.trim()
  if (!externalLeadId) return

  const at = new Date()
  await notifyEvent({
    type: 'integration.ingestion_failed',
    agencyId: connection.agency_id,
    entityType: 'integration',
    entityId: connection.id,
    actorUserId: null,
    occurredAt: at,
    payload: {
      provider: 'facebook',
      externalLeadId,
    },
  })
}
