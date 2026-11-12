import 'server-only'
import { markSmartbeeConnectionInvalid } from '@/db/smartbee/connections'
import {
  deferSmartbeeSubmit,
  findSmartbeeDocument,
  markSmartbeeDocumentStalled,
  markSmartbeeSubmitStarted,
  recordPollOutcome,
  recordSubmitOutcome,
  type SmartbeeDocumentRow,
} from '@/db/smartbee/documents'
import type { IntegrationConnection } from '@/lib/integrations/core/types'
import type { SmartbeeAuthDeps } from './auth'
import { createSmartbeeDocument, pollSmartbeeDocument } from './documents'

/**
 * One step forward for one stored document. The ONLY code that calls SmartBee
 * for a document, used by the executor (first submit), the after() follow-up
 * and the minute sweep.
 *
 *   pending → submit the STORED request with its STORED providerMsgId. A lost
 *             answer leaves it pending and the next step sends the same id,
 *             which SmartBee answers with 95 and the original message id.
 *   queued  → poll by the stored apiMessageId.
 *
 * A pending row is submitted only through the agency's CURRENT active
 * connection, in the SAME environment it was approved for, while the
 * connection's owner is still the user who approved it. A connection moved from
 * test to production never receives a sandbox request. Polling needs no
 * business token, so a queued row is followed even if the connection was since
 * revoked: we still want to know whether the document exists.
 *
 * "MAY HAVE BEEN SENT" is `submitAttempts > 0`, counted BEFORE each send
 * (markSmartbeeSubmitStarted), so a crash mid-request still counts. Such a row
 * is NEVER marked failed because a retry cannot run now: it stays pending with
 * the SAME providerMsgId (deferred) until the connection is usable again, and
 * the same rule holds for a 98 on a retry. Only a request that was never sent,
 * or one SmartBee itself rejected (400), is `failed`.
 *
 * Gives up after `GIVE_UP_MS`, as `stalled`: never re-submitted, never reported
 * as issued, and the owner is told the outcome is unconfirmed.
 */

export const GIVE_UP_MS = 24 * 60 * 60 * 1000

export type LifecycleDeps = {
  create?: typeof createSmartbeeDocument
  poll?: typeof pollSmartbeeDocument
  auth?: SmartbeeAuthDeps
}

/** 1s, 2s, 4s … 30s while someone is waiting (the guide's schedule), then once a minute from the sweep. */
export function nextPollDelayMs(pollAttempts: number): number {
  return pollAttempts < 6 ? Math.min(1000 * 2 ** pollAttempts, 30_000) : 60_000
}

export async function advanceSmartbeeDocument(
  row: SmartbeeDocumentRow,
  connection: IntegrationConnection | null,
  nowMs: number,
  deps: LifecycleDeps = {},
): Promise<SmartbeeDocumentRow> {
  const reread = async () => (await findSmartbeeDocument(row.agencyId, row.id)) ?? row
  if (row.status !== 'pending' && row.status !== 'queued') return row

  if (nowMs - new Date(row.createdAt).getTime() > GIVE_UP_MS) {
    await markSmartbeeDocumentStalled(row.agencyId, row.id, nowMs)
    return reread()
  }

  if (row.status === 'pending') {
    const blocked = dispatchBlocker(row, connection)
    const maySent = row.submitAttempts > 0
    if (blocked) {
      // Never sent: honestly not created. Possibly sent: keep it, same providerMsgId, and try again later.
      if (maySent) await deferSmartbeeSubmit(row.agencyId, row.id, `blocked_${blocked}`, nowMs)
      else await recordSubmitOutcome(row.agencyId, row.id, { kind: 'rejected', reason: blocked, code: null, details: null }, nowMs)
      return reread()
    }
    await markSmartbeeSubmitStarted(row.agencyId, row.id, nowMs)
    const outcome = await (deps.create ?? createSmartbeeDocument)(row.environment, row.requestSnapshot, connection!.secret, deps.auth)
    if (outcome.kind === 'rejected' && outcome.reason === 'invalid_provider_token') {
      await markSmartbeeConnectionInvalid(row.agencyId, 'smartbee_98')
      // A 98 answers only THIS request; an earlier, unanswered one may have created the document.
      if (maySent) {
        await deferSmartbeeSubmit(row.agencyId, row.id, 'blocked_invalid_provider_token', nowMs)
        return reread()
      }
    }
    await recordSubmitOutcome(row.agencyId, row.id, outcome, nowMs)
    return reread()
  }

  if (!row.apiMessageId) return row
  const outcome = await (deps.poll ?? pollSmartbeeDocument)(row.environment, row.apiMessageId, deps.auth)
  await recordPollOutcome(row.agencyId, row.id, outcome, nowMs, nextPollDelayMs(row.pollAttempts + 1))
  return reread()
}

export type DispatchBlocker = 'connection_unavailable' | 'connection_inactive' | 'environment_changed' | 'owner_changed'

/** Why this pending row may not be sent through this connection right now, or null when it may. */
export function dispatchBlocker(row: SmartbeeDocumentRow, connection: IntegrationConnection | null): DispatchBlocker | null {
  if (!connection || connection.agencyId !== row.agencyId || connection.id !== row.connectionId) return 'connection_unavailable'
  if (connection.status !== 'active') return 'connection_inactive'
  if (connection.environment !== row.environment) return 'environment_changed'
  if (connection.ownerUserId !== row.approvedByUserId) return 'owner_changed'
  return null
}

export const isTerminal = (s: SmartbeeDocumentRow['status']) => s === 'created' || s === 'draft' || s === 'failed' || s === 'stalled'
