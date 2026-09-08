import type { Roles } from '@/types/roles'
import type { Plan } from '@/lib/quota/types'

/**
 * SocialCRM Agent — shared types.
 *
 * The Agent investigates by calling business-level tools rather than being
 * handed one fixed snapshot. These are the contracts every tool and the loop
 * share. All are plain data: no I/O, no framework.
 */

/**
 * Server-resolved authority for ONE investigation.
 *
 * Captured in every tool closure. It is NEVER accepted from the model and never
 * appears in a tool's input schema — that is what makes agency isolation
 * structural rather than a prompt instruction. See lib/agent/scope.ts.
 */
export type AgentScope = {
  agencyId: number
  userId: number
  role: Roles
  /**
   * Permission set from `getPerms`. Empty for admins (unrestricted — the
   * `isAdmin` branch at each query site is what widens it), `[0]` for a user
   * with no grants (a sentinel that matches no row).
   */
  gotPermIds: number[]
  plan: Plan
  /** Resolved via getFirstName; '' when no name source exists. */
  firstName: string
}

/**
 * A citable source. The only thing a claim may point at.
 *
 * Entity refs carry the id a tool actually returned. A metric ref carries its
 * name, the window it was measured over and the sample size — so an OBSERVATION
 * can never be surfaced without the `n` that makes it honest.
 *
 * A metric also records WHAT IT WAS MEASURED ON, when it was measured over one
 * entity. Without that binding a metric is subject-less: `lead.overdueTaskCount
 * = 0` states a number but names nothing a rep could open, so a claim resting
 * only on it has no provenance to walk and can never be surfaced. `measuredOn`
 * is written by the TOOL that took the measurement, never by the model, and is
 * absent for portfolio-wide metrics (`get_today_state`), which are measured over
 * no single subject and must not borrow one.
 */
export type EvidenceRef =
  | { kind: 'lead'; refId: string }
  | { kind: 'conversation'; refId: string }
  | { kind: 'message'; refId: string }
  | {
      kind: 'metric'
      metric: string
      window: { from: string; to: string }
      n: number
      measuredOn?: { kind: EvidenceEntityKind; refId: string }
    }
  /**
   * A page the hosted web search actually consulted. THE ONLY EXTERNAL EVIDENCE.
   *
   * Harvested from the provider's own output after the search ran — never from
   * the model, which cannot add a URL it did not receive, and never before the
   * search returns.
   *
   * IT IS NOT AN ENTITY, and that is the whole security boundary. `source` is
   * absent from `EvidenceEntityKind`, so `evidence.has()` cannot be asked for
   * one, `parseEntityRef` refuses `source:...`, and the action gates — which ask
   * `has('lead', id)` — have no argument that a source could satisfy. External
   * content can support a sentence; it can never select a row to write to.
   *
   * WHAT IT DELIBERATELY OMITS is retrieved page text. Storing attacker-
   * controlled prose so it can be replayed into a later prompt is the injection
   * surface this design exists to avoid; the model read the page during the
   * search and the citation is what survives.
   */
  | {
      kind: 'source'
      /** Short, stable, model-citable: `src_1`. Assigned at harvest, never by the model. */
      refId: string
      url: string
      title: string
      /** Publisher identity, derived from the URL we were given — never from page content. */
      domain: string
      /** ISO. The only time claim we can honestly support; publication date is not available. */
      retrievedAt: string
    }

/**
 * The entity kinds addressable by `EvidenceCollector.has`.
 *
 * `source` and `metric` are deliberately absent: each has its own accessor
 * (`hasSource`, `hasMetric`) because each grounds a different class of claim.
 * Widening this union is the single edit that would let external content ground
 * a FACT or an action — see the note on the `source` ref above.
 */
export type EvidenceEntityKind = 'lead' | 'conversation' | 'message'

/**
 * Epistemic class of one statement.
 *
 * These are a DISCRIMINATED UNION with class-specific evidence field names, not
 * a single shape with a label. That is deliberate: if every class carried the
 * same `evidence: string[]`, relabelling an inference as a fact would cost the
 * model one string and only prose inspection could catch it — which would make
 * the whole trust boundary rest on a regex.
 *
 * Instead each class asks for a differently-named field holding a different
 * KIND of evidence, and the validator checks the refs actually resolve to that
 * kind in the collector:
 *
 *   FACT           entityEvidence — lead / conversation / message refIds
 *   OBSERVATION    metricEvidence — metric names that exist WITH their sample size
 *   INFERENCE      evidence (either kind) AND a hedge in the prose
 *   RECOMMENDATION evidence (either kind)
 *   PRODUCT        productEvidence — canonical product topic ids
 *
 * PRODUCT IS A DIFFERENT KNOWLEDGE DOMAIN, not a loosened one. A statement about
 * what SocialCRM does is not a statement about this customer's rows, so demanding
 * CRM evidence for it was a category error — that is why "למה המערכת הזו טובה?"
 * came back as "לא מצאתי מספיק נתונים". It still has to cite: a PRODUCT claim
 * names a topic in `lib/agent/product/knowledge`, and a topic that does not exist
 * fails exactly as an invented lead id does. What changes is WHICH source has to
 * hold the reference, never whether one is required.
 *
 * Promoting an inference to a FACT therefore means moving refs into
 * `entityEvidence` and having them resolve to real entities; promoting it to an
 * OBSERVATION means naming a metric the collector actually holds. Mislabelling
 * costs fabrication the validator can detect, rather than a relabel it cannot.
 */
export const CLAIM_CLASSES = ['FACT', 'OBSERVATION', 'INFERENCE', 'RECOMMENDATION', 'PRODUCT', 'SOURCED'] as const
export type ClaimClass = (typeof CLAIM_CLASSES)[number]

/** Something read directly from source rows. Cites the rows. */
export type FactClaim = {
  claimClass: 'FACT'
  text: string
  /** lead / conversation / message refIds. Must resolve as entities. */
  entityEvidence: string[]
}

/** A measurement. Cites the metric, which carries its own window and sample size. */
export type ObservationClaim = {
  claimClass: 'OBSERVATION'
  text: string
  /** Metric names. Must exist in the collector — a metric ref carries `n`. */
  metricEvidence: string[]
}

/** A judgement about relationship or cause. Must be hedged AND grounded. */
export type InferenceClaim = {
  claimClass: 'INFERENCE'
  text: string
  /** Entity refIds or metric names — either kind grounds an inference. */
  evidence: string[]
}

/**
 * Something true about SocialCRM itself — capability, terminology, how to start.
 *
 * Grounded in the canonical topics, never in the customer's data. It can never
 * carry a business number: no product topic holds one, so a claim that tried
 * would have to cite CRM evidence and would be a FACT or an OBSERVATION instead.
 */
export type ProductClaim = {
  claimClass: 'PRODUCT'
  text: string
  /** Product topic ids. Must exist in the canonical registry. */
  productEvidence: string[]
}

/**
 * Something the world says, read from a page the search actually consulted.
 *
 * THE COUNTERPART TO `FACT`, AND KEPT APART FROM IT ON PURPOSE. A FACT is a row
 * in this customer's database; a SOURCED claim is someone else's publication.
 * Collapsing them would let "a competitor raised prices" wear the same badge as
 * "this lead has waited six days", and only one of those is something we can
 * actually stand behind.
 *
 * It cites `sourceEvidence` — source refIds that must resolve in THIS run's
 * collector. It can carry a number, unlike PRODUCT, because a page can state
 * one; what it cannot do is present that number as the customer's own, since a
 * claim about the customer's data has to cite the customer's data.
 */
export type SourcedClaim = {
  claimClass: 'SOURCED'
  text: string
  /** Source refIds. Must resolve against harvested sources — never entities. */
  sourceEvidence: string[]
}

/** Proposed next action. Advice, never asserted as fact. */
export type RecommendationClaim = {
  claimClass: 'RECOMMENDATION'
  text: string
  /** Entity refIds or metric names — either kind grounds a recommendation. */
  evidence: string[]
}

export type Claim = FactClaim | ObservationClaim | InferenceClaim | RecommendationClaim | ProductClaim | SourcedClaim

/** The refs a claim cites, whatever its class calls the field. */
export function claimRefs(claim: Claim): string[] {
  switch (claim.claimClass) {
    case 'FACT':
      return claim.entityEvidence
    case 'OBSERVATION':
      return claim.metricEvidence
    case 'PRODUCT':
      return claim.productEvidence
    case 'SOURCED':
      return claim.sourceEvidence
    default:
      return claim.evidence
  }
}

/** Rebuild a claim with a new ref list, preserving its class and field name. */
export function withClaimRefs(claim: Claim, refs: string[]): Claim {
  switch (claim.claimClass) {
    case 'FACT':
      return { ...claim, entityEvidence: refs }
    case 'OBSERVATION':
      return { ...claim, metricEvidence: refs }
    case 'PRODUCT':
      return { ...claim, productEvidence: refs }
    case 'SOURCED':
      return { ...claim, sourceEvidence: refs }
    default:
      return { ...claim, evidence: refs }
  }
}

/**
 * The agent's read on the business right now — its diagnosis, not its report.
 *
 * It exists so the model has to COMMIT to one, which is the difference between
 * an advisor and a dashboard: "nothing is urgent" and "nothing is worth doing"
 * are different findings, and a surface with no word for the gap between them
 * defaults to the first and stops there.
 *
 *   URGENT       something needs attention now
 *   AT_RISK      no fire, but a pattern that becomes one if ignored
 *   OPPORTUNITY  no problem, and still a clearly better use of the next hour
 *   HEALTHY      no risk and no opportunity the evidence can actually support
 *
 * `null` when the question was not about the business at all — a greeting or a
 * product question has no business state, and inventing one would be noise.
 *
 * NOT a claim, and deliberately not evidence-cited: it is a label over claims
 * that carry their own evidence. The validator still refuses to let it assert
 * pressure out of nothing — see the downgrade rule in ./validate.
 */
export const BUSINESS_STATES = ['URGENT', 'AT_RISK', 'OPPORTUNITY', 'HEALTHY'] as const
export type BusinessState = (typeof BUSINESS_STATES)[number]

/**
 * An action the model is ASKING to perform. It has performed nothing.
 *
 * Kept out of `Claim` deliberately: a claim is something asserted to be true
 * about the business, and "I would like to create a task" is neither true nor
 * false yet. Only an `ActionOutcome` from the Action Runtime can say whether
 * anything happened.
 */
export type ProposedAction =
  | {
      actionType: 'create_task'
      args: { clientId: number; title: string; dueDate: string }
      evidenceRefs: string[]
    }
  | {
      actionType: 'create_follow_up'
      /** A follow-up is lead state, so the lead IS the target. Date-level only. */
      args: { clientId: number; at: string; note?: string | null }
      evidenceRefs: string[]
    }
  | {
      actionType: 'create_meeting'
      /** The one action that really persists a time of day. */
      args: {
        clientId: number
        title: string
        date: string
        startTime: string
        durationMinutes: number
        note?: string | null
      }
      evidenceRefs: string[]
    }

/**
 * One action across many leads. Expanded by the application into N ordinary
 * `ActionProposal`s — never executed as a single bulk mutation.
 */
export type ProposedBatch = {
  actionType: 'create_task'
  targets: number[]
  args: { title: string; dueDate: string }
  evidenceRefs: string[]
}

export type AgentAnswer = {
  /** The one-line conclusion the rep reads first. */
  headline: string
  claims: Claim[]
  /** Honest statement of what could not be determined, or null. */
  unknown: string | null
  /** The business diagnosis, or null for a non-business question. */
  businessState?: BusinessState | null
  /** A request to act, or null. Never evidence that acting happened. */
  proposedAction?: ProposedAction | null
  /** A request to act on several leads at once, or null. */
  proposedBatch?: ProposedBatch | null
}

/** Why an investigation ended. Recorded on every run for observability. */
export type StopReason =
  | 'answered'
  | 'step_ceiling'
  | 'deadline'
  | 'repeat_call'
  | 'no_new_information'
  | 'no_evidence'
  | 'gate_denied'
  | 'error'

/**
 * `investigationId` is minted server-side in lib/agent/run.ts and is the same id
 * that correlates the trace lines and the persisted row. It is returned so a
 * later question about an answer can be traced to the run that produced it. It
 * is NEVER accepted as input: a caller-supplied id would let one client
 * overwrite another's history, because persistence is first-write-wins.
 *
 * Optional on failure because a request can fail before an id exists — an empty
 * question is rejected before any investigation starts.
 */
export type AgentResult =
  | {
      ok: true
      answer: AgentAnswer
      evidence: EvidenceRef[]
      steps: number
      stopReason: StopReason
      investigationId: string
      /**
       * The Action Runtime's verdict on `answer.proposedAction`, or null when the
       * answer proposed nothing.
       *
       * THIS IS THE ONLY FIELD THAT MAY SAY ANYTHING HAPPENED. The answer's prose
       * is the model's; this is the application's, and the two are kept apart on
       * purpose — a headline saying a task was created alongside an outcome of
       * AWAITING_APPROVAL means the prose is wrong, not that the task exists.
       */
      actionOutcome?: import('./actions/types').ActionOutcome | null
      /**
       * The Action Runtime's verdict on `answer.proposedBatch`, or null.
       *
       * An aggregation of N independent outcomes — never a single bulk result.
       * Like `actionOutcome`, this and not the prose is what may say anything
       * happened.
       */
      batchOutcome?: import('./actions/batch').BatchOutcome | null
      /**
       * What this investigation actually cost, in USD.
       *
       * Exposed in Phase 4.3 because the autonomous path holds a durable budget
       * reservation that must be SETTLED against the real figure — a hold that is
       * never closed against actuals is a hold that silently over-charges the day.
       * The interactive path may ignore it; nothing about its behaviour changes.
       *
       * Zero when generation never began (an admission denial spends nothing).
       */
      costUsd: number
    }
  | {
      ok: false
      reason: StopReason
      message?: string
      investigationId?: string
      /** Tokens are spent even when the answer is refused or the provider fails. */
      costUsd?: number
      /**
       * EXECUTION TELEMETRY ON THE FAILURE PATH — present whenever generation ran.
       *
       * These were assembled for `onPersist` and then dropped from the return, so a
       * caller that persists from the AgentResult rather than from `onPersist` — the
       * autonomous path — wrote nothing and `ai_investigations` fell back to its
       * column defaults (`steps 0`, `evidence []`, `droppedClaims 0`,
       * `strippedRefs 0`). That made "four tools ran, then the validator refused"
       * indistinguishable from "no tool ran, then the validator refused", and three
       * production investigations were diagnosed against a number that was a DEFAULT,
       * never a measurement.
       *
       * Optional because two failures genuinely have no telemetry: an admission
       * denial never began, and a provider throw before any step has nothing to
       * report. Absent means "not measured", never "measured as zero".
       */
      steps?: number
      evidence?: EvidenceRef[]
      droppedClaims?: number
      strippedRefs?: number
      /** The validator's own rejection reason, so a refusal says WHY. */
      rejection?: string
      /**
       * Which blocklist rule fired, for an `unsupported-claim` refusal —
       * `RULE_17` and so on. Names our own phrase, never the user's text.
       */
      rejectionRuleId?: string | null | null
    }
