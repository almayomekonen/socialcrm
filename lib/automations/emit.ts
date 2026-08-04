import type { Knex } from 'knex'
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { listActiveDefinitionsForTrigger, type AutomationDefinition } from '@/db/automations/definitions'
import { enqueueAutomationJob } from '@/db/automations/jobs'
import { isAutomationsAgencyAllowlisted, isAutomationsEnabled } from './flags'
import { isValidTiming, resolveSendAtDetailed } from './timing'
import { snapshotConditionsMatch } from './conditionEvaluator'
import { eventKeyForEngineTrigger, snapshotFieldsForEvent } from './catalog/engineBridge'
import { getEvent } from './catalog/registry'
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
  | { emitted: number; skippedDefinitions: number; filteredDefinitions: number }
  | {
      blocked:
        | 'origin_import'
        | 'kill_switch'
        | 'agency_not_allowlisted'
        | 'no_active_definitions'
        /** The catalog does not describe this trigger, so no condition on it
         *  can be decided. Unreachable while every TriggerType is bridged. */
        | 'event_undescribed'
        | 'error'
    }

/** ADR-010 identity rule — deterministic from business facts, never random. */
export function eventKeyFor(event: AutomationTriggerEvent): string {
  // An external occurrence knows its own identity — the connector declared it.
  // The two internal events predate connectors and derive theirs here.
  if (event.occurrenceKey) return event.occurrenceKey
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

    // The catalog entry for this occurrence. Unknown ⇒ nothing is emitted:
    // an event the catalog cannot describe has undecidable conditions, and
    // the engine never acts on a condition it could not evaluate (Law 3).
    const definition = getEvent(eventKeyForEngineTrigger(event.trigger) ?? '')
    if (!definition) return { blocked: 'event_undescribed' }
    const snapshot = snapshotFieldsForEvent(event)

    const eventKey = eventKeyFor(event)
    let emitted = 0
    let skippedDefinitions = 0
    let filteredDefinitions = 0
    for (const def of definitions) {
      // SNAPSHOT conditions are decided here. Their values are fixed at the
      // event and cannot change afterwards, so evaluating them now is the same
      // answer as evaluating them at execution — and it avoids queuing work
      // that could never succeed. Live conditions are the worker's business.
      if (!snapshotConditionsMatch(definition, def.conditions, snapshot).pass) {
        filteredDefinitions++
        continue
      }
      const timing = def.content?.timing
      if (!timing || !isValidTiming(timing)) {
        // Unknown/invalid stored concept ⇒ held inert, never guessed (ADR-008).
        console.warn('[automations] definition held inert: invalid timing', { automationId: def.id })
        skippedDefinitions++
        continue
      }

      /**
       * The due moment. A BEFORE-ANCHOR timing resolves from a datetime the
       * occurrence itself carries (the meeting's start), and can legitimately
       * fail to resolve: a meeting booked twenty minutes before it starts has no
       * "one hour before" moment left. Both misses are ordinary outcomes — a
       * reminder that cannot be timed is not sent, and inventing a moment would
       * mean emailing about a meeting already under way.
       *
       * No new scheduling machinery: this only changes the arithmetic that
       * produces `notBefore`, which the queue has always used.
       */
      const due = resolveSendAtDetailed(event.occurredAt, timing, snapshot)
      if (due.miss) {
        console.log('[automations] anchored send produced no job', {
          automationId: def.id,
          leadId: event.leadId,
          reason: due.miss,
        })
        filteredDefinitions++
        continue
      }

      const id = await deps.enqueue({
        agencyId: event.agencyId,
        automationId: def.id,
        leadId: event.leadId,
        trigger: event.trigger,
        origin: event.origin,
        eventKey,
        notBefore: due.at,
      })
      if (id != null) emitted++
    }
    return { emitted, skippedDefinitions, filteredDefinitions }
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

/**
 * Post-commit immediate-case kick (ADR-011 §after()): best-effort ONLY — the
 * cron drain is the correctness guarantee. Runs after the response, never
 * affects the emitting request, swallowed outside request scope (tests,
 * scripts). Lazy imports keep the emission path light.
 */
function kickWorkerSoon(): void {
  void (async () => {
    try {
      const { after } = await import('next/server')
      after(async () => {
        const { runAutomationWorker } = await import('./worker')
        await runAutomationWorker({ limit: 5, workerId: 'after-kick' })
      })
    } catch {
      // No request scope — the cron drains within its cadence.
    }
  })()
}

/** Production wiring. `trx` joins the caller's transaction when provided. */
export async function emitAutomationEvent(event: AutomationTriggerEvent, opts?: { trx?: Knex.Transaction }): Promise<EmitResult> {
  const result = await emitAutomationEventWith(
    {
      enabled: isAutomationsEnabled,
      allowlisted: isAutomationsAgencyAllowlisted,
      listActive: listActiveDefinitionsForTrigger,
      enqueue: (args) => enqueueAutomationJob(opts?.trx ?? db, args),
      shadow: shadowMetric,
    },
    event,
  )
  if ('emitted' in result && result.emitted > 0) kickWorkerSoon()
  return result
}
