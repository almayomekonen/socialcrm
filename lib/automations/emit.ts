import type { Knex } from 'knex'
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import {
  listActiveDefinitionsForTrigger,
  type AutomationDefinition,
} from '@/db/automations/definitions'
import { enqueueAutomationJob } from '@/db/automations/jobs'
import { isAutomationsAgencyAllowlisted, isAutomationsEnabled } from './flags'
import { isValidTiming, resolveSendAt } from './timing'
import type { AutomationTriggerEvent } from './types'

/**
 * Trigger emission — the ONLY door into the engine's queue (ADR-010: every
 * event arrives in the canonical contract shape; eventKeyFor below is the
 * identity rule). Gate order, cheapest first:
 *
 *   origin gate (pure: import is inert) → kill switch (env; blocked ⇒ SHADOW
 *   metric, no DB touched) → agency allowlist (env) → active definitions
 *   (DB) → enqueue one job per matching definition (conflict-ignore dedup).
 *
 * NEVER throws — call sites live inside lead ingestion and protected server
 * actions; an emission failure is logged and swallowed, never propagated.
 */

export type EmitResult =
  | { emitted: number; skippedDefinitions: number }
  | { blocked: 'origin_import' | 'kill_switch' | 'agency_not_allowlisted' | 'no_active_definitions' | 'error' }

/** ADR-010 identity rule — deterministic from business facts, never random. */
export function eventKeyFor(event: AutomationTriggerEvent): string {
  if (event.trigger === 'status_changed') {
    return `status_changed:${event.newStatus}:${event.occurredAt.getTime()}`
  }
  return 'lead_created'
}

export type EmitDeps = {
  enabled: () => boolean
  allowlisted: (agencyId: number) => boolean
  listActive: (agencyId: number, trigger: AutomationTriggerEvent['trigger']) => Promise<AutomationDefinition[]>
  enqueue: (args: {
    agencyId: number
    automationId: number
    leadId: number
    trigger: AutomationTriggerEvent['trigger']
    origin: AutomationTriggerEvent['origin']
    eventKey: string
    notBefore: Date
  }) => Promise<number | null>
  shadow: (event: AutomationTriggerEvent) => Promise<void>
}

export async function emitAutomationEventWith(deps: EmitDeps, event: AutomationTriggerEvent): Promise<EmitResult> {
  try {
    if (event.origin === 'import') return { blocked: 'origin_import' }

    if (!deps.enabled()) {
      // Kill switch engaged: record the shadow metric — the proof of what the
      // engine WOULD have processed — and stop before any engine query.
      await deps.shadow(event)
      return { blocked: 'kill_switch' }
    }

    if (!deps.allowlisted(event.agencyId)) return { blocked: 'agency_not_allowlisted' }

    const definitions = await deps.listActive(event.agencyId, event.trigger)
    if (definitions.length === 0) return { blocked: 'no_active_definitions' }

    const eventKey = eventKeyFor(event)
    let emitted = 0
    let skippedDefinitions = 0
    for (const def of definitions) {
      const timing = def.content?.timing
      if (!timing || !isValidTiming(timing)) {
        // Unknown/invalid stored concept ⇒ held inert, never guessed (ADR-008).
        console.warn('[automations] definition held inert: invalid timing', { automationId: def.id })
        skippedDefinitions++
        continue
      }
      const id = await deps.enqueue({
        agencyId: event.agencyId,
        automationId: def.id,
        leadId: event.leadId,
        trigger: event.trigger,
        origin: event.origin,
        eventKey,
        notBefore: resolveSendAt(event.occurredAt, timing),
      })
      if (id != null) emitted++
    }
    return { emitted, skippedDefinitions }
  } catch (err) {
    console.error('[automations] emit failed (swallowed)', {
      trigger: event.trigger,
      origin: event.origin,
      agencyId: event.agencyId,
      leadId: event.leadId,
      err: String(err),
    })
    return { blocked: 'error' }
  }
}

async function shadowMetric(event: AutomationTriggerEvent): Promise<void> {
  const payload = {
    trigger: event.trigger,
    origin: event.origin,
    agencyId: event.agencyId,
    leadId: event.leadId,
    occurredAt: event.occurredAt.toISOString(),
    ...(event.newStatus != null ? { newStatus: event.newStatus } : {}),
  }
  console.log('[automations] shadow (kill switch engaged — would have emitted)', payload)
  // Queryable counterpart in analytics_events; track() never throws.
  await track({ agencyId: event.agencyId, event: 'automation_event_shadow', props: payload })
}

/** Production wiring. `trx` joins the caller's transaction when provided. */
export async function emitAutomationEvent(
  event: AutomationTriggerEvent,
  opts?: { trx?: Knex.Transaction },
): Promise<EmitResult> {
  return emitAutomationEventWith(
    {
      enabled: isAutomationsEnabled,
      allowlisted: isAutomationsAgencyAllowlisted,
      listActive: listActiveDefinitionsForTrigger,
      enqueue: (args) => enqueueAutomationJob(opts?.trx ?? db, args),
      shadow: shadowMetric,
    },
    event,
  )
}
