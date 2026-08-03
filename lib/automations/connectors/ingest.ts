import type { AutomationTriggerEvent, TriggerOrigin } from '../types'
import { engineTriggerForEventKey } from '../catalog/engineBridge'
import { getEvent } from '../catalog/registry'
import type { MappedEvent, WebhookConnector } from './types'

/**
 * The generic inbound pipeline: provider payload → engine event.
 *
 *   verify → map → describe → resolve subject → emit
 *
 * Every step is a call into the connector or the catalog. This module names no
 * integration, reads no provider field and branches on no integration key —
 * which is exactly why adding Calendly needed a connector and catalog rows
 * rather than a new ingestion path.
 *
 * Every rejection is EXPLICIT and named. A webhook that is dropped says which
 * step dropped it, because a silently swallowed booking is indistinguishable
 * from a working integration until a customer complains.
 */

export type IngestOutcome =
  | { accepted: true; leadId: number; event: AutomationTriggerEvent }
  | { accepted: false; reason: IngestRejection }

export type IngestRejection =
  /** Signature check failed — the request is not from the provider. */
  | 'invalid_signature'
  /** Body was not JSON we could read. */
  | 'unreadable_payload'
  /** A payload type this connector does not act on. Not an error. */
  | 'not_actionable'
  /** The connector named an event key the catalog does not describe (Law 3). */
  | 'event_undescribed'
  /** The catalog event has no engine trigger — unbridged (Law 3). */
  | 'event_unbridged'
  /** Law 2: no single Lead. The occurrence cannot exist for this engine. */
  | 'subject_unresolved'

/** Origin for everything a connector delivers. Provenance, not identity. */
const WEBHOOK_ORIGIN: TriggerOrigin = 'webhook'

export type IngestDeps = {
  resolveSubject: (agencyId: number, mapped: MappedEvent) => Promise<number | null>
  emit: (event: AutomationTriggerEvent) => Promise<unknown>
}

export async function ingestWebhookWith(
  connector: WebhookConnector,
  deps: IngestDeps,
  input: { agencyId: number; headers: Record<string, string>; body: string },
): Promise<IngestOutcome> {
  if (!connector.verifyWebhook({ headers: input.headers, body: input.body })) {
    return { accepted: false, reason: 'invalid_signature' }
  }

  let payload: unknown
  try {
    payload = JSON.parse(input.body)
  } catch {
    return { accepted: false, reason: 'unreadable_payload' }
  }

  const mapped = connector.mapEvent(payload)
  if (!mapped) return { accepted: false, reason: 'not_actionable' }

  // The catalog is the authority on what an event IS. A connector naming an
  // undescribed event is inert, never guessed at.
  if (!getEvent(mapped.eventKey)) return { accepted: false, reason: 'event_undescribed' }
  const trigger = engineTriggerForEventKey(mapped.eventKey)
  if (!trigger) return { accepted: false, reason: 'event_unbridged' }

  // Law 2, enforced here rather than trusted: the connector resolves, and an
  // occurrence with no single Lead never reaches the engine.
  const leadId = await deps.resolveSubject(input.agencyId, mapped)
  if (!leadId) return { accepted: false, reason: 'subject_unresolved' }

  const event: AutomationTriggerEvent = {
    trigger,
    origin: WEBHOOK_ORIGIN,
    agencyId: input.agencyId,
    leadId,
    occurredAt: mapped.occurredAt,
    fields: mapped.fields,
    occurrenceKey: mapped.occurrenceKey,
  }
  await deps.emit(event)
  return { accepted: true, leadId, event }
}
