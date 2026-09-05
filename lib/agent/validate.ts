import { containsUnsupportedBusinessClaim } from '@/lib/copilot/general/unsupportedClaims'
import { BUSINESS_STATES, CLAIM_CLASSES, claimRefs, withClaimRefs, type AgentAnswer, type BusinessState, type Claim } from './types'
import { parseEntityRef } from './evidence'
import { isProductTopic } from './product/knowledge'
import type { EvidenceCollector } from './evidence'

/**
 * The Agent Trust Gate — deterministic, no model, no heuristics beyond a
 * declared marker list.
 *
 * It generalises two production primitives rather than inventing a philosophy:
 *   · `validateReasoning` (lib/copilot/general/validate.ts) — whole-answer
 *     rejection on an unsupported business claim, developer-only diagnostics,
 *     and the rule that it NEVER rescues an unsupportable answer;
 *   · `validateObservation` (lib/copilot/general/synthesis) — per-item evidence
 *     membership: strip invalid refs, drop the item if none survive.
 *
 * What it adds is class-specific evidence. A FACT must cite entities, an
 * OBSERVATION must cite a metric the collector actually produced, and an
 * INFERENCE must be both grounded and hedged. Because the claim classes are a
 * discriminated union with different field names (see ./types), relabelling an
 * inference as a fact is not a rename — it means moving refs into
 * `entityEvidence` and having them resolve as entities.
 *
 * Bias, unchanged from the Copilot gate: false negatives are acceptable, false
 * positives are not. When uncertain, drop.
 *
 * KNOWN LIMITATION — `containsUnsupportedBusinessClaim` is a 26-phrase
 * substring blocklist. It catches KNOWN phrasings of conversion/heat/outcome
 * claims, not arbitrary novel ones. A newly-worded unsupported claim passes
 * this gate. Evidence membership, not the blocklist, is the load-bearing check.
 */

/**
 * Hedge markers accepted for an INFERENCE. Deliberately narrow and enumerated
 * rather than clever: the list is the contract, the prompt asks for exactly
 * these, and the test suite asserts every one of them is honoured.
 *
 * A hedge is NECESSARY, never SUFFICIENT — an inference still has to cite real
 * evidence. Hedging is about not overstating; it says nothing about being right.
 */
export const HEDGE_MARKERS: readonly string[] = [
  'ייתכן',
  'יתכן',
  'נראה ש',
  'כנראה',
  'אולי',
  'שווה לבדוק',
  'ייתכן ש',
  'לא בטוח',
  'עשוי',
  'עשויה',
  'possibly',
  'perhaps',
  'maybe',
  'appears',
  'seems',
  'likely',
  'might',
]

export type DropReason = 'no-valid-evidence' | 'inference-not-hedged'

export type DroppedClaim = { text: string; reason: DropReason }

/** DEVELOPER-ONLY. Never rendered to a user. */
export type AgentTrustDiagnostics = {
  dropped: DroppedClaim[]
  strippedRefs: { text: string; removed: string[] }[]
}

export type ValidatedAgentAnswer = {
  headline: string
  claims: Claim[]
  unknown: string | null
  businessState: BusinessState | null
  diagnostics: AgentTrustDiagnostics
}

/**
 * A diagnosis of pressure has to rest on something.
 *
 * URGENT and AT_RISK both assert that the business needs attention. If every
 * claim was dropped — or none was ever made — there is nothing behind the
 * assertion, and stamping it on the answer would be exactly the manufactured
 * urgency this surface must never produce: the one thing that makes a rep stop
 * believing the signals that are real.
 *
 * OPPORTUNITY and HEALTHY are not downgraded. Neither claims anything is wrong,
 * so neither can invent pressure — and HEALTHY on a thin answer is an honest
 * "I found nothing", which is a finding worth keeping.
 *
 * A downgrade returns null rather than rewriting the state to something milder:
 * the model's other diagnoses were not what it meant, and substituting one would
 * be the validator inventing a business read of its own.
 */
function groundedBusinessState(state: BusinessState | null, keptClaims: Claim[]): BusinessState | null {
  if (state !== 'URGENT' && state !== 'AT_RISK') return state
  const hasEvidencedFinding = keptClaims.some((c) => c.claimClass === 'FACT' || c.claimClass === 'OBSERVATION')
  return hasEvidencedFinding ? state : null
}

/** Why a whole answer was refused, when no individual claim survived to explain it. */
export type RejectionReason = 'malformed' | 'unsupported-claim' | 'no-supportable-claim'

/**
 * PROSE-FREE summary of what the gate did. Safe to trace and to persist.
 *
 * The rejected text itself is deliberately absent: the gate destroyed it, and
 * writing it into a log or a history row would give an unsupported claim a
 * second life. Counts answer the operational question — how often, and which
 * rule — without carrying the content.
 */
export type AgentTrustCounts = {
  droppedClaims: number
  strippedRefs: number
  byReason: Record<DropReason, number>
}

/**
 * The full outcome, including WHY a refusal happened.
 *
 * `validateAgentAnswer` returns only the answer and is unchanged; this exists
 * because returning a bare `null` threw away the one thing an operator needs
 * when the Agent refuses in production. Investigation inv_mt7795vh_ptvevm
 * completed generation, collected 21 evidence items, refused — and left no
 * record of whether the blocklist, the hedge rule or reference resolution fired.
 */
export type AgentValidation = {
  /** null when the answer was refused. */
  answer: ValidatedAgentAnswer | null
  /** null when the answer was accepted. */
  rejection: RejectionReason | null
  counts: AgentTrustCounts
}

function zeroCounts(): AgentTrustCounts {
  return { droppedClaims: 0, strippedRefs: 0, byReason: { 'no-valid-evidence': 0, 'inference-not-hedged': 0 } }
}

function refused(rejection: RejectionReason, counts: AgentTrustCounts = zeroCounts()): AgentValidation {
  return { answer: null, rejection, counts }
}

/** Strip the `refId=` prefix the model may echo from a payload label, and trim. */
function normalizeRef(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^refId=/, '')
    .trim()
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/**
 * Does this ref resolve to a real ENTITY (lead / conversation / message)?
 *
 * TWO ACCEPTED FORMS, ONE MEANING. `lead:161` is the canonical form tools now
 * emit and the prompt states; `161` is the bare id that every existing tool and
 * test already produces. Both resolve to the same evidence.
 *
 * A QUALIFIED REF IS CHECKED AGAINST ITS OWN KIND AND NOTHING ELSE. That is what
 * keeps the kind meaningful: `lead:161` asks the collector for a LEAD 161, and
 * if the collector holds only a message 161 it does not resolve. Stripping the
 * prefix and trying all three kinds would have made `lead:161` and
 * `message:161` interchangeable, which is a weaker contract than the one this
 * codebase had before the fix.
 *
 * An UNRECOGNISED prefix parses as null and falls through to the bare lookup,
 * where it cannot match: `customer:161` is asked for as the literal id
 * `"customer:161"` and no tool ever emitted that. So a made-up entity kind fails
 * closed rather than quietly resolving on its digits.
 */
function resolvesAsEntity(ref: string, evidence: EvidenceCollector): boolean {
  const qualified = parseEntityRef(ref)
  if (qualified) return evidence.has(qualified.kind, qualified.id)
  return evidence.has('lead', ref) || evidence.has('conversation', ref) || evidence.has('message', ref)
}

/** Does this ref name a metric the collector actually produced? */
function resolvesAsMetric(ref: string, evidence: EvidenceCollector): boolean {
  return evidence.hasMetric(ref)
}

/**
 * Does this ref name a real product topic?
 *
 * Checked against the canonical registry rather than the evidence collector,
 * because product knowledge is not gathered per investigation — it is a
 * server-owned constant, identical for every agency, and carries no customer
 * data. There is nothing to scope and nothing a tool could have fetched.
 *
 * It is still a MEMBERSHIP CHECK, not a waiver: `product.invented_feature` fails
 * exactly as an invented lead id does. What a PRODUCT claim cannot do is carry a
 * business number, because no topic holds one — a claim that tried would have to
 * cite CRM evidence, and would then be a FACT or an OBSERVATION and be judged as
 * one.
 */
function resolvesAsProduct(ref: string): boolean {
  return isProductTopic(ref)
}

/**
 * The evidence kind a claim class demands. FACT and OBSERVATION are narrow on
 * purpose; INFERENCE and RECOMMENDATION accept either, because a judgement can
 * rest on a measurement as legitimately as on a row.
 */
function refResolver(claim: Claim): (ref: string, evidence: EvidenceCollector) => boolean {
  switch (claim.claimClass) {
    case 'FACT':
      return resolvesAsEntity
    case 'OBSERVATION':
      return resolvesAsMetric
    case 'PRODUCT':
      return (ref) => resolvesAsProduct(ref)
    default:
      return (ref, evidence) => resolvesAsEntity(ref, evidence) || resolvesAsMetric(ref, evidence)
  }
}

export function hasHedge(text: string): boolean {
  const t = (text ?? '').toLowerCase()
  return HEDGE_MARKERS.some((m) => t.includes(m.toLowerCase()))
}

/** Structural shape check. A malformed payload is rejected, never repaired. */
function isWellFormed(answer: AgentAnswer | null | undefined): answer is AgentAnswer {
  if (!answer || typeof answer !== 'object') return false
  if (typeof answer.headline !== 'string' || answer.headline.trim() === '') return false
  if (!Array.isArray(answer.claims)) return false
  if (answer.unknown !== null && typeof answer.unknown !== 'string') return false
  // Absent is fine (an older payload); a present value must be a real state.
  const state = (answer as AgentAnswer).businessState
  if (state != null && !(BUSINESS_STATES as readonly string[]).includes(state)) return false
  return answer.claims.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      (CLAIM_CLASSES as readonly string[]).includes((c as Claim).claimClass) &&
      typeof (c as Claim).text === 'string' &&
      (c as Claim).text.trim() !== '' &&
      Array.isArray(claimRefs(c as Claim)),
  )
}

/**
 * Validate one candidate answer against the evidence THIS investigation
 * actually gathered. Returns null when nothing supportable survives — the
 * caller degrades honestly rather than surfacing a repaired guess.
 */
export function validateAgentAnswerDetailed(
  answer: AgentAnswer,
  evidence: EvidenceCollector,
  opts?: {
    /**
     * Refuse an answer that proposed NO claims at all.
     *
     * The autonomous path sets this. There, the system has already established
     * that a specific expectation was violated, so a "finding" asserting nothing
     * is not a finding — it is a wasted run, and surfacing it would put an empty
     * notification in front of an operator. The interactive path leaves it off,
     * because there a claimless answer is usually a greeting or an honest
     * "I cannot determine this", both of which are useful replies to a person
     * who asked a question.
     *
     * It has no effect on claims that WERE proposed: those are judged the same
     * way on both paths.
     */
    requireClaim?: boolean
  },
): AgentValidation {
  if (!isWellFormed(answer)) return refused('malformed')

  // Whole-answer reject: an unsupported business claim anywhere poisons it.
  // Matches the Copilot gate's stance — this is not repairable per-claim,
  // because the headline and the unknown line are the model's own prose.
  const prose = [answer.headline, ...answer.claims.map((c) => c.text), answer.unknown ?? ''].join('\n')
  if (containsUnsupportedBusinessClaim(prose)) return refused('unsupported-claim')

  const kept: Claim[] = []
  const dropped: DroppedClaim[] = []
  const strippedRefs: { text: string; removed: string[] }[] = []

  for (const claim of answer.claims) {
    // An unhedged inference is dropped before its evidence is even considered:
    // the problem is the framing, and a well-cited overstatement is still an
    // overstatement.
    if (claim.claimClass === 'INFERENCE' && !hasHedge(claim.text)) {
      dropped.push({ text: claim.text, reason: 'inference-not-hedged' })
      continue
    }

    // Repair first (normalize + dedupe), then membership-filter by class.
    const distinct = uniq(claimRefs(claim).map(normalizeRef))
    const resolves = refResolver(claim)
    const valid = distinct.filter((ref) => resolves(ref, evidence))
    const removed = distinct.filter((ref) => !resolves(ref, evidence))

    if (valid.length === 0) {
      dropped.push({ text: claim.text, reason: 'no-valid-evidence' })
      continue
    }
    if (removed.length > 0) strippedRefs.push({ text: claim.text, removed })

    kept.push(withClaimRefs(claim, valid))
  }

  const counts: AgentTrustCounts = {
    droppedClaims: dropped.length,
    strippedRefs: strippedRefs.length,
    byReason: {
      'no-valid-evidence': dropped.filter((d) => d.reason === 'no-valid-evidence').length,
      'inference-not-hedged': dropped.filter((d) => d.reason === 'inference-not-hedged').length,
    },
  }

  /**
   * Nothing survived — but WHY decides whether that is a refusal.
   *
   * If claims were proposed and every one was destroyed, the answer rested on
   * things that are not true and must not be shown. That is the original rule
   * and it is unchanged.
   *
   * If the model proposed NO claims at all, nothing was destroyed and there is
   * nothing unsupported to hide. That is a greeting, or an honest "I cannot
   * determine this" — and refusing it was a real defect: a live run produced four
   * answers whose `unknown` correctly explained that conversion rate and revenue
   * are not available, and all four were discarded, so the rep saw a generic
   * error instead of the accurate explanation the model had actually written.
   *
   * The distinction is exactly `dropped.length`, which is why it can be made
   * safely: an unsupported claim still cannot reach the user by this path,
   * because a claim that was never proposed cannot be one.
   *
   * `requireClaim` restores the stricter rule for the autonomous path — see the
   * option's own note.
   */
  if (kept.length === 0 && (dropped.length > 0 || opts?.requireClaim === true)) {
    return refused('no-supportable-claim', counts)
  }

  return {
    answer: {
      headline: answer.headline,
      claims: kept,
      unknown: answer.unknown,
      businessState: groundedBusinessState(answer.businessState ?? null, kept),
      diagnostics: { dropped, strippedRefs },
    },
    rejection: null,
    counts,
  }
}

/**
 * The original contract, unchanged: the validated answer, or null.
 *
 * Kept as the ergonomic entry point so every existing call site and test reads
 * exactly as before. It delegates — there is one implementation, not two.
 */
export function validateAgentAnswer(
  answer: AgentAnswer,
  evidence: EvidenceCollector,
): ValidatedAgentAnswer | null {
  return validateAgentAnswerDetailed(answer, evidence).answer
}
