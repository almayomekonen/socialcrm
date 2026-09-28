import type { EvidenceCollector } from './evidence'
import type { BusinessState, Claim } from './types'

/**
 * What a diagnosis has to rest on, decided deterministically.
 *
 * Every state on this surface is an assertion about the business, and each kind
 * of assertion fails in a different direction. URGENT and AT_RISK claim pressure,
 * so their failure mode is manufactured alarm — one false one discounts every
 * real signal afterwards. HEALTHY claims the opposite, and its failure mode is
 * quieter and worse: an owner told the business is fine stops looking. Both are
 * gated here; neither is gated by prose.
 *
 * THE RULE FOR HEALTHY IS NOT THE MIRROR OF THE RULE FOR URGENT. Pressure needs
 * a finding. Calm needs a finding AND a wide enough look to have earned it,
 * because "I did not find a problem" and "there is no problem" are different
 * statements and only the second one is HEALTHY. A narrow investigation cannot
 * establish global health: it did not look at the thing it is reassuring the
 * owner about.
 *
 * This replaces the earlier stance that HEALTHY on a thin answer was "an honest
 * 'I found nothing' worth keeping". Live evaluation showed what that costs.
 * Question A2 on the tenant with real overdue follow-ups asked about a trend,
 * got an inconclusive comparison, said so correctly in prose — *"אין כרגע מספיק
 * פעילות כדי לקבוע"* — and still carried `businessState: HEALTHY` into the UI,
 * where the state is read as a verdict on the whole business. The prose was
 * right and the label was wrong. `null` is what "not enough to say" looks like.
 */

/**
 * Metric namespaces produced by a tool that reads the WHOLE lead book.
 *
 * `business.` (get_business_summary), `health.` (get_lead_health) and
 * `followup.` (get_follow_up_health) each survey every lead in the agency, so
 * their absence of findings is itself a finding.
 *
 * Deliberately EXCLUDED, each for its own reason:
 *   · `today.`    — the daily queue. Phase 2.5.1 established that a stale lead,
 *                   a lead with no next step, and a lead gone cold can all be
 *                   absent from it. It cannot see what it does not queue.
 *   · `activity.` — two windows of event counts. A trend measures change, not
 *                   condition, and the tool itself reports `comparisonReliable`
 *                   precisely because the comparison is often not one.
 *   · `segment.`  — one named category, by construction not the book.
 *   · `lead.`     — one person.
 *
 * Kept as a prefix list rather than importing the tools' id constants because
 * this module is pure and those modules are `server-only`. `__tests__/ai/agent/
 * healthyState.test.ts` imports both and asserts they have not drifted apart.
 */
export const WHOLE_BOOK_HEALTH_METRIC_PREFIXES = ['business.', 'health.', 'followup.'] as const

/** Did this investigation actually survey the whole book? */
export function sawWholeBookEvidence(evidence: EvidenceCollector): boolean {
  return evidence
    .all()
    .some(
      (ref) =>
        ref.kind === 'metric' &&
        WHOLE_BOOK_HEALTH_METRIC_PREFIXES.some((prefix) => ref.metric.startsWith(prefix)),
    )
}

/** A claim that asserts something measured, as opposed to advising or guessing. */
function hasEvidencedFinding(keptClaims: Claim[]): boolean {
  return keptClaims.some((c) => c.claimClass === 'FACT' || c.claimClass === 'OBSERVATION')
}

/**
 * The state the user is allowed to see, given what survived validation.
 *
 * A downgrade returns `null` rather than a milder state: the model's other
 * diagnoses are not what it meant, and substituting one would be the validator
 * inventing a business read of its own.
 */
export function groundedBusinessState(
  state: BusinessState | null,
  keptClaims: Claim[],
  evidence: EvidenceCollector,
): BusinessState | null {
  if (state === null) return null

  // Pressure must rest on something measured. Advice is not a finding, and a
  // hedged guess is explicitly not one either.
  if (state === 'URGENT' || state === 'AT_RISK') {
    return hasEvidencedFinding(keptClaims) ? state : null
  }

  // Calm must rest on something measured AND on having looked widely enough for
  // its absence to mean anything.
  if (state === 'HEALTHY') {
    if (!hasEvidencedFinding(keptClaims)) return null
    return sawWholeBookEvidence(evidence) ? state : null
  }

  // OPPORTUNITY is unchanged: it asserts neither pressure nor safety, so it can
  // neither alarm nor reassure falsely. It still cannot reach the user on an
  // answer whose every claim was destroyed — that answer is refused outright,
  // one layer up.
  return state
}
