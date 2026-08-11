import type { Knex } from 'knex'
import { db } from '@/config/db'
import { enqueueNotificationJob } from '@/db/notifications/jobs'
import { eventKeyForEvent } from './eventKey'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from './flags'
import { getNotificationType } from './registry'
import type { NotificationEvent } from './types'

/**
 * notifyEvent — THE ONLY DOOR into the notification queue. Spec §3, §14.
 *
 * Gate order, cheapest first:
 *
 *   kill switch (one string compare; blocked ⇒ shadow log, NO DB TOUCHED)
 *   → agency allowlist (env)
 *   → registry lookup (unknown or disabled type ⇒ nothing enqueued)
 *   → ONE guarded INSERT (ON CONFLICT DO NOTHING absorbs webhook retries)
 *   → after() kick, best-effort
 *
 * NEVER THROWS. Call sites live inside Facebook/WhatsApp lead ingestion and
 * inside protected server actions. A notification is a courtesy; the lead is the
 * business. If anything here fails, it is logged and swallowed, and the lead is
 * saved exactly as it is today.
 *
 * WHY THIS IS SAFE IN THE CRITICAL PATH: everything expensive — recipient
 * resolution, role lookups, preference reads, copy rendering, dedup scans,
 * channel dispatch — happens in the worker. This function does one INSERT with
 * no joins and no fan-out, so the webhook returns 200 to Meta in the time it
 * does today.
 */

export type NotifyResult =
  | { enqueued: true; jobId: number }
  /** The event was already enqueued — a webhook retry, or the reconciliation
   *  sweep re-offering an event that landed. A no-op, never an error. */
  | { enqueued: false; reason: 'duplicate' }
  | { enqueued: false; reason: 'kill_switch' | 'agency_not_allowlisted' | 'unknown_type' | 'type_disabled' | 'error' }

/**
 * Shadow metric: proof of what the system WOULD have delivered, for reading the
 * blast radius before the flag is ever turned on.
 *
 * Console only — deliberately unlike the automation engine's shadow, which also
 * writes analytics_events. Spec §23.1 requires the master switch to touch NO
 * database, and a kill switch that still writes a row per webhook is not fully
 * off.
 */
function shadow(event: NotificationEvent): void {
  console.log('[notifications] shadow (kill switch engaged — would have enqueued)', {
    type: event.type,
    agencyId: event.agencyId,
    entityType: event.entityType,
    entityId: event.entityId,
    occurredAt: event.occurredAt.toISOString(),
  })
}

/**
 * Post-response worker kick — best-effort ONLY. The cron drain is the
 * correctness guarantee (spec §14, §23.3); `after()` is just what makes the
 * common case feel immediate instead of up to a minute late.
 *
 * Swallows the absence of a request scope, so scripts, tests and cron callers
 * are unaffected. Lazy imports keep the emission path light.
 */
function kickWorkerSoon(): void {
  void (async () => {
    try {
      const { after } = await import('next/server')
      after(async () => {
        const { runNotificationWorker } = await import('./worker')
        await runNotificationWorker({ limit: 5, workerId: 'after-kick' })
      })
    } catch {
      // No request scope — the cron drains within its cadence.
    }
  })()
}

/**
 * `trx` joins the caller's transaction, so the enqueue COMMITS OR ROLLS BACK
 * WITH the business event that caused it (spec §14.1). Mirrors
 * `emitAutomationEvent(event, { trx })` exactly.
 *
 * Where no transaction exists — the webhook ingestion paths, which perform a
 * bare insert — the reconciliation sweep closes the gap (spec §14.3). It is
 * never closed by wrapping a protected ingestion path in a transaction.
 */
export async function notifyEvent(event: NotificationEvent, opts?: { trx?: Knex.Transaction }): Promise<NotifyResult> {
  try {
    if (!isNotificationsEnabled()) {
      shadow(event)
      return { enqueued: false, reason: 'kill_switch' }
    }

    if (!isNotificationsAgencyAllowlisted(event.agencyId)) {
      return { enqueued: false, reason: 'agency_not_allowlisted' }
    }

    const def = getNotificationType(event.type)
    if (!def) {
      // Unknown concept ⇒ held inert, never guessed. Mirrors the automation
      // engine's treatment of an undescribed trigger.
      console.warn('[notifications] unknown type, nothing enqueued', { type: event.type })
      return { enqueued: false, reason: 'unknown_type' }
    }
    if (!def.enabled) return { enqueued: false, reason: 'type_disabled' }

    const jobId = await enqueueNotificationJob(opts?.trx ?? db, {
      agencyId: event.agencyId,
      type: event.type,
      eventKey: eventKeyForEvent(event),
      actorUserId: event.actorUserId ?? null,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload ?? {},
    })

    if (jobId == null) return { enqueued: false, reason: 'duplicate' }

    kickWorkerSoon()
    return { enqueued: true, jobId }
  } catch (err) {
    console.error('[notifications] enqueue failed (swallowed)', {
      type: event.type,
      agencyId: event.agencyId,
      entityType: event.entityType,
      entityId: event.entityId,
      err: String(err),
    })
    return { enqueued: false, reason: 'error' }
  }
}
