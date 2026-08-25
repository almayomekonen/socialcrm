import { classifyLead } from '@/lib/today/classify'
import type { LeadFact, NowCtx } from '@/lib/today/types'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { Scope } from '@/db/ai/stateManagement'
import type { DetectorDef } from './registry'

/**
 * Detector — `followup.overdue`.
 *
 * The first deterministic CRM detector: it turns "a follow-up date passed and
 * nothing happened" into the canonical `absence` ExternalSignal that
 * `interpret()` already accepts. This is §3.4's ingestion mechanism, which the
 * ratified runtime deliberately leaves to implementation ("must not… choose an
 * ingestion mechanism"). It introduces no signal type, no severity, no
 * admission decision and no ranking — those belong to contracts that exist.
 *
 * IT DOES NOT DECIDE WHAT OVERDUE MEANS. `lib/today/classify.ts` is the single
 * authority for the six qualifying states, and this detector calls it rather
 * than re-deriving one of them in SQL or in a second predicate. That matters
 * for more than DRY: `classifyLead` evaluates STATE_PRIORITY in order, so a
 * lead whose follow-up has passed but who is ALSO waiting on our reply
 * classifies as WAITING_REPLY and correctly produces no overdue signal here.
 * A hand-rolled `nextFollowUpAt < dayStart` would have emitted it, and the
 * runtime would have been told a deadline was missed while the real owed
 * action was a reply.
 *
 * Terminal statuses are excluded by that same call (`isTerminal` runs first in
 * `classifyLead`), and again at the SQL layer in db/ai/leadFacts.ts.
 *
 * PURE. No I/O, no clock read, no model, no provider — `nowMs` and the business
 * day bounds arrive in `ctx`, computed once by the caller from the canonical
 * `lib/today/time.ts` (the repository's sole "today" boundary authority).
 *
 * The emitted order is the input order. Detectors observe; they never rank —
 * comparative ordering across subjects is the executive lens inside Reasoning
 * (§3.6 must-not), and a `severityHint` here would relocate it.
 */

/** The expectation whose violation this detector reports. Also the absence marker. */
export const FOLLOWUP_OVERDUE_EXPECTATION = 'followup.overdue'

export function detectFollowupOverdue(facts: readonly LeadFact[], ctx: NowCtx, scope: Scope): ExternalSignal[] {
  const occurredAt = new Date(ctx.nowMs).toISOString()
  const signals: ExternalSignal[] = []

  for (const fact of facts) {
    if (classifyLead(fact, ctx) !== 'FOLLOWUP_OVERDUE') continue
    // Unreachable through classifyLead (the state requires a non-null date), and
    // asserted anyway: an absence signal without a real violated deadline would
    // be an unobserved fact asserted as observed.
    if (fact.nextFollowUpAt == null) continue

    const subjectId = String(fact.id)
    signals.push({
      signalType: 'absence',
      scope,
      source: { kind: 'system', id: `detector:${FOLLOWUP_OVERDUE_EXPECTATION}` },
      occurredAt,
      subject: { subjectType: 'lead', subjectId },
      // Provenance walks back to the lead row the deadline was read from. No
      // customer identity, no operator identity, no permission context.
      traceRefs: [{ type: 'lead', id: subjectId }],
      inferentialDistance: 'low',
      absence: {
        violatedExpectation: FOLLOWUP_OVERDUE_EXPECTATION,
        expectedBy: new Date(fact.nextFollowUpAt).toISOString(),
        ...(fact.lastActivityAt != null ? { sinceLastSignalAt: new Date(fact.lastActivityAt).toISOString() } : {}),
      },
    })
  }

  return signals
}

export const followupOverdueDetector: DetectorDef = {
  expectation: FOLLOWUP_OVERDUE_EXPECTATION,
  detect: detectFollowupOverdue,
}
