import { classifyLead } from '@/lib/today/classify'
import { HOUR_MS, SLA_HOURS_BY_STATUS } from '@/lib/today/constants'
import type { LeadFact, NowCtx } from '@/lib/today/types'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { Scope } from '@/db/ai/stateManagement'
import type { DetectorDef } from './registry'

/**
 * Detector — `sla.open_loop`.
 *
 * The conversation was answered, and then it stopped. `message.unanswered` dies
 * the moment ANY outbound lands — including an auto-response — so once a reply
 * exists no notification watches that conversation again. `followup.*` only fires
 * if someone thought to schedule a date, and the defining feature of an abandoned
 * lead is that nobody did. The state is visible in Today and delivered by nothing.
 *
 * IT DOES NOT DECIDE WHAT AN OPEN LOOP IS. `lib/today/classify.ts` is the single
 * authority, and this detector calls it rather than re-deriving the predicate.
 * That matters for more than DRY: `classifyLead` evaluates STATE_PRIORITY in
 * order, so a lead that satisfies the SLA conditions but is ALSO waiting on our
 * reply classifies as WAITING_REPLY and correctly produces no signal here — the
 * owed action is a reply, not a revival. The same deference hands us the terminal
 * exclusion, the scheduled-follow-up exclusion, the open-task exclusion and the
 * 14-day stale ceiling without restating one of them.
 *
 * THE VIOLATED EXPECTATION. `expectedBy` is `lastActivityAt + the status SLA`, read
 * from `SLA_HOURS_BY_STATUS` — the same table `isOpenLoopSla` consults. It is the
 * moment a next step was owed, not the moment we noticed, which is what makes the
 * observation key stable across sweeps: the same untouched open loop re-detected
 * sixty times an hour is one observation.
 *
 * PURE. No I/O, no clock read, no model, no provider — `nowMs` and the business-day
 * bounds arrive in `ctx`, computed once by the caller from `lib/today/time.ts`.
 *
 * The emitted order is the input order. Detectors observe; they never rank.
 */

/** The expectation whose violation this detector reports. Also the absence marker. */
export const OPEN_LOOP_SLA_EXPECTATION = 'sla.open_loop'

/**
 * The moment a next step became owed: the last activity plus that status's SLA.
 *
 * Returns null when the status carries no SLA — unreachable through
 * `classifyLead` (OPEN_LOOP_SLA requires one) and asserted anyway, because an
 * absence signal without a real violated deadline would be an unobserved fact
 * asserted as observed.
 */
export function openLoopExpectedByMs(fact: LeadFact): number | null {
  if (fact.status == null || fact.lastActivityAt == null) return null
  const slaHours = SLA_HOURS_BY_STATUS[fact.status]
  if (slaHours == null) return null
  return fact.lastActivityAt + slaHours * HOUR_MS
}

export function detectOpenLoopSla(facts: readonly LeadFact[], ctx: NowCtx, scope: Scope): ExternalSignal[] {
  const occurredAt = new Date(ctx.nowMs).toISOString()
  const signals: ExternalSignal[] = []

  for (const fact of facts) {
    if (classifyLead(fact, ctx) !== 'OPEN_LOOP_SLA') continue
    const expectedBy = openLoopExpectedByMs(fact)
    if (expectedBy == null) continue

    const subjectId = String(fact.id)
    signals.push({
      signalType: 'absence',
      scope,
      source: { kind: 'system', id: `detector:${OPEN_LOOP_SLA_EXPECTATION}` },
      occurredAt,
      subject: { subjectType: 'lead', subjectId },
      // Provenance walks back to the lead row the SLA was measured against. No
      // customer identity, no operator identity, no permission context.
      traceRefs: [{ type: 'lead', id: subjectId }],
      inferentialDistance: 'low',
      absence: {
        violatedExpectation: OPEN_LOOP_SLA_EXPECTATION,
        expectedBy: new Date(expectedBy).toISOString(),
        ...(fact.lastActivityAt != null ? { sinceLastSignalAt: new Date(fact.lastActivityAt).toISOString() } : {}),
      },
    })
  }

  return signals
}

export const openLoopSlaDetector: DetectorDef = {
  expectation: OPEN_LOOP_SLA_EXPECTATION,
  detect: detectOpenLoopSla,
}
