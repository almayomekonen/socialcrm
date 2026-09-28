import { createEvidenceCollector } from '@/lib/agent/evidence'
import { admitsResearch } from '@/lib/agent/research/admission'
import { harvestSources } from '@/lib/agent/research/harvest'
import { providerSupportsHostedSearch } from '@/lib/agent/research/tool'
import { researchFailureReasonOf } from '@/lib/agent/research/telemetry'
import { validateAgentAnswerDetailed } from '@/lib/agent/validate'
import { groundedProposal } from '@/lib/agent/proposalGate'
import { groundedBatch } from '@/lib/agent/batchGate'
import type { ResearchCase } from './cases'

/**
 * The OFFLINE executor: production's own decisions, with the provider injected.
 *
 * IT IMPORTS THE REAL THING AT EVERY STEP — `admitsResearch`,
 * `providerSupportsHostedSearch`, `harvestSources`, `researchFailureReasonOf`,
 * `validateAgentAnswerDetailed`, `groundedProposal`, `groundedBatch`. Nothing
 * here reimplements a rule. If it did, the suite would measure the copy and pass
 * while production failed, which is the specific way evaluation harnesses rot.
 *
 * WHAT IS SIMULATED IS ONLY THE PROVIDER: which model was resolved, what the
 * search returned, whether the call threw. Those are the conditions we cannot
 * summon on demand — a failover to Anthropic, an outage, a hostile page — and
 * they are exactly the conditions the security guarantees are about.
 *
 * ONE THING IS DELIBERATELY NOT SIMULATED: the model's judgement. Where a case
 * scripts an answer it scripts the worst one, and the assertion is that the
 * runtime refuses regardless. A suite that depended on the model behaving would
 * be measuring the wrong layer.
 */

export type CaseObservation = {
  researchRequested: boolean
  researchAdmitted: boolean
  hostedSearchCalls: number
  rawSourceRecords: number
  uniqueSources: number
  admittedSources: number
  rejectedSources: number
  sourcesByDomain: Record<string, number>
  groundedSourcedClaims: number
  /** Claims the validator destroyed. */
  droppedClaims: number
  /** Survived validation AND the action gate. Must be 0 wherever a source is the only evidence. */
  actionProposals: number
  batchProposals: number
  /** Rows written. Offline is structurally 0; live is measured against the database. */
  mutations: number
  citationUrls: string[]
  failureReason: string | null
  answered: boolean
  elapsedMs: number
  researchWallMs: number
}

const AT = '2026-09-08T00:00:00.000Z'

export function executeOffline(c: ResearchCase): CaseObservation {
  const startedAt = Date.now()
  const request = admitsResearch(c.question)
  const provider = c.provider ?? 'openai'
  const admitted = request.admitted && providerSupportsHostedSearch(provider)

  const evidence = createEvidenceCollector()
  const harvest = admitted
    ? harvestSources(c.providerSources as never, { retrievedAt: AT })
    : { refs: [], rawRecords: 0, unique: 0, cappedOut: 0, unusable: 0, byDomain: {} as Record<string, number> }
  // A provider that threw, or a run cut off at the deadline, harvested nothing —
  // the sources never arrived. Modelled by discarding them, not by a flag.
  const failed = c.simulate === 'provider-error' || c.simulate === 'deadline'
  if (!failed) for (const ref of harvest.refs) evidence.add(ref)

  const hostedSearchCalls = admitted && !failed ? (c.hostedSearchCalls ?? 0) : admitted ? (c.hostedSearchCalls ?? 0) : 0
  const admittedSources = failed ? 0 : harvest.refs.length

  const failureReason = researchFailureReasonOf({
    researchRequested: request.admitted,
    researchAdmitted: admitted,
    hostedSearchCalls,
    rawSourceRecords: failed ? 0 : harvest.rawRecords,
    admittedSources,
    providerError: c.simulate === 'provider-error',
    timedOut: c.simulate === 'deadline',
  })

  /**
   * The answer runs through the REAL validator and the REAL gates. A case with
   * no scripted answer asserts only the research accounting; it does not invent
   * prose to score.
   */
  let grounded = 0
  let dropped = 0
  let answered = false
  let actionProposals = 0
  let batchProposals = 0
  const citationUrls: string[] = []

  if (c.scriptedAnswer) {
    const v = validateAgentAnswerDetailed(c.scriptedAnswer, evidence)
    answered = v.answer !== null
    dropped = v.counts.droppedClaims
    if (v.answer) {
      grounded = v.answer.claims.filter((cl) => cl.claimClass === 'SOURCED').length
      for (const cl of v.answer.claims) {
        if (cl.claimClass !== 'SOURCED') continue
        for (const ref of cl.sourceEvidence) {
          const src = evidence.sources().find((s) => s.refId === ref)
          if (src) citationUrls.push(src.url)
        }
      }
      // The gates decide, not the schema. `validate` already applies them; these
      // re-assert on the validated answer so a change in either is caught here.
      if (groundedProposal(v.answer.proposedAction ?? null, evidence)) actionProposals++
      if (groundedBatch(v.answer.proposedBatch ?? null, evidence)) batchProposals++
    }
  }

  return {
    researchRequested: request.admitted,
    researchAdmitted: admitted,
    hostedSearchCalls,
    rawSourceRecords: failed ? 0 : harvest.rawRecords,
    uniqueSources: failed ? 0 : harvest.unique,
    admittedSources,
    rejectedSources: failed ? 0 : harvest.cappedOut + harvest.unusable,
    sourcesByDomain: failed ? {} : harvest.byDomain,
    groundedSourcedClaims: grounded,
    droppedClaims: dropped,
    actionProposals,
    batchProposals,
    // Offline never reaches the Action Runtime, so nothing can be written. The
    // database-level proof of that lives in
    // __tests__/ai/agent/research/promptInjection.integration.test.ts.
    mutations: 0,
    citationUrls,
    failureReason,
    answered,
    elapsedMs: Date.now() - startedAt,
    researchWallMs: 0,
  }
}
