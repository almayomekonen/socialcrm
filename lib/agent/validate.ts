import { containsUnsupportedBusinessClaim } from '@/lib/copilot/general/unsupportedClaims'
import { CLAIM_CLASSES, claimRefs, withClaimRefs, type AgentAnswer, type Claim } from './types'
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
  diagnostics: AgentTrustDiagnostics
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

/** Does this ref resolve to a real ENTITY (lead / conversation / message)? */
function resolvesAsEntity(ref: string, evidence: EvidenceCollector): boolean {
  return evidence.has('lead', ref) || evidence.has('conversation', ref) || evidence.has('message', ref)
}

/** Does this ref name a metric the collector actually produced? */
function resolvesAsMetric(ref: string, evidence: EvidenceCollector): boolean {
  return evidence.hasMetric(ref)
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
export function validateAgentAnswer(
  answer: AgentAnswer,
  evidence: EvidenceCollector,
): ValidatedAgentAnswer | null {
  if (!isWellFormed(answer)) return null

  // Whole-answer reject: an unsupported business claim anywhere poisons it.
  // Matches the Copilot gate's stance — this is not repairable per-claim,
  // because the headline and the unknown line are the model's own prose.
  const prose = [answer.headline, ...answer.claims.map((c) => c.text), answer.unknown ?? ''].join('\n')
  if (containsUnsupportedBusinessClaim(prose)) return null

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

  // Never rescue an answer with nothing supportable left.
  if (kept.length === 0) return null

  return {
    headline: answer.headline,
    claims: kept,
    unknown: answer.unknown,
    diagnostics: { dropped, strippedRefs },
  }
}
