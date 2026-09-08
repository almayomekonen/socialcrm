/**
 * THE SCORING CONTRACT — what a number in the report is allowed to mean.
 *
 * Versioned separately from the questions. A scoring change leaves the forty
 * comparable question-for-question but makes the TOTALS incomparable, so both
 * versions are stamped on every report and a reader can tell which kind of
 * change happened.
 *
 * WHAT WAS RECOVERED AND WHAT WAS FORMALISED. The recovered harness printed
 * per-case tool lists, business states, latency and the CRM before/after counts,
 * and it counted proposals and batches itself. It did NOT compute "structural"
 * or "Today-only broad" — those two were applied by hand to the printed output
 * in the original sessions. They are formalised here for the first time, which
 * is why they are called out: their DEFINITIONS are ours, their INPUTS are the
 * original's. Everything else is a direct transcription.
 *
 * NOTHING HERE INVENTS AN EXPECTED ANSWER. The original benchmark defined no
 * per-case expected headline, claim set or business state, so neither does this.
 * Business state and specificity are RECORDED, never asserted.
 */
import type { AgentAnswer } from '@/lib/agent/types'

export const SCORING_VERSION = 'scoring@1.1.0'

/**
 * Stop reasons that mean THE AGENT NEVER RAN.
 *
 * `gate_denied` is the AI admission gate refusing before a single token is
 * spent — a disabled flag, an un-allowlisted agency, no configured provider, a
 * spent daily cap, or a lapsed product-access entitlement. None of those is a
 * statement about the agent's answer, because there was no answer.
 *
 * WHY THIS EXISTS. The 2026-09-08 run scored ten such cases as `other failures`
 * under scoring@1.0.0, which made a fixture whose trial had expired read as ten
 * agent failures. Both numbers were "10"; only one of them meant anything. A
 * case that could not be evaluated and a case the agent answered badly are
 * different facts and now have different counters.
 *
 * DELIBERATELY NARROW. `error` is not here: a provider throw or a runtime fault
 * happened while the agent was running and is a real failure of the run. Only
 * refusals that precede execution are unevaluable.
 */
export const UNEVALUABLE_STOP_REASONS = ['gate_denied'] as const

/**
 * Tools that answer a question about the BUSINESS rather than about today.
 *
 * The distinction the whole set was built to measure. `get_today_state` is the
 * daily queue: correct for "what do I do now", insufficient for "what is my
 * biggest problem", because a full queue and a shrinking business are different
 * facts and only one of them is visible in the queue.
 */
export const STRUCTURAL_TOOLS = ['get_business_summary', 'get_lead_health', 'get_follow_up_health', 'get_activity_trends'] as const

/** The daily queue tool, named once so the rule below reads as the rule it is. */
export const TODAY_TOOL = 'get_today_state'

/** Latency and round-trip telemetry, lifted from the run's own trace records. */
export type CaseTiming = {
  /** Wall clock around the whole investigation, measured by the harness. */
  totalMs: number
  /** Derived by the runtime: generation time not spent inside a tool. */
  modelWaitMs: number | null
  toolWallMs: number | null
  toolCalls: number | null
  /** Model round trips. One means the agent answered without a second pass. */
  toolRoundTrips: number | null
}

/** Everything one case produced. Raw, before any aggregation. */
export type CaseResult = {
  id: string
  tenantLabel: string
  questionIndex: number
  question: string
  answered: boolean
  /** Present on both paths; `deadline` is the one that matters most. */
  stopReason: string
  investigationId: string | null
  steps: number | null
  evidenceCount: number | null
  toolsUsed: string[]
  droppedClaims: number
  strippedRefs: number
  /** The validator's refusal, e.g. `unsupported-claim`. Null when answered. */
  rejection: string | null
  /** Which blocklist phrase fired, e.g. `RULE_17`. Null unless that rule refused. */
  rejectionRuleId: string | null
  /** Recorded, never asserted — the original defined no expected state. */
  businessState: string | null
  headline: string | null
  proposedAction: unknown | null
  proposedBatch: unknown | null
  timing: CaseTiming
  /** Set only when the harness itself threw. Distinct from an agent refusal. */
  harnessError: string | null
}

export type Totals = {
  cases: number
  retired: number
  /** Cases that actually reached the agent. The honest denominator. */
  evaluated: number
  /** Cases refused before the agent ran. Never counted as agent failures. */
  unevaluable: number
  answered: number
  unsupportedClaimFailures: number
  groundingFailures: number
  droppedClaims: number
  strippedRefs: number
  spuriousProposals: number
  spuriousBatches: number
  todayOnlyBroad: number
  sawStructuralTool: number
  deadlineFailures: number
  harnessErrors: number
  otherFailures: number
  roundTrips: number
  toolCalls: number
  totalMs: number
  modelWaitMs: number
  toolWallMs: number
}

/**
 * The case never reached the agent, so it measures the environment, not the
 * product. Reported in its own counter and excluded from every quality metric.
 */
export const isUnevaluable = (r: CaseResult): boolean =>
  r.answered === false && (UNEVALUABLE_STOP_REASONS as readonly string[]).includes(r.stopReason)

/**
 * A refusal caused by the claim gate — the model asserted something the evidence
 * did not support and the validator destroyed the answer rather than ship it.
 */
export const isUnsupportedClaimFailure = (r: CaseResult): boolean =>
  r.answered === false && r.rejection === 'unsupported-claim'

/**
 * Evidence that did not survive contact with the collector.
 *
 * A dropped claim or a stripped ref means the model cited something the tools
 * never returned. Non-zero is a grounding failure even when the answer shipped,
 * because the answer shipped SMALLER than the model intended and the difference
 * is fabrication that got caught.
 */
export const isGroundingFailure = (r: CaseResult): boolean =>
  r.droppedClaims > 0 || r.strippedRefs > 0 || r.rejection === 'ungrounded'

/**
 * A broad judgement question answered from the daily queue alone.
 *
 * Every question in this set is broad, so the rule needs no per-case flag: an
 * answered case that touched Today and never touched a structural tool answered
 * "how is my business" with "here is today's list".
 *
 * A case that used NO tools at all is not counted here — that is a different
 * failure (it would show as a grounding failure or a refusal), and folding the
 * two together would hide both.
 */
export const isTodayOnlyBroad = (r: CaseResult): boolean =>
  r.answered && r.toolsUsed.includes(TODAY_TOOL) && !r.toolsUsed.some((t) => (STRUCTURAL_TOOLS as readonly string[]).includes(t))

export const sawStructural = (r: CaseResult): boolean =>
  r.toolsUsed.some((t) => (STRUCTURAL_TOOLS as readonly string[]).includes(t))

/**
 * A write proposed by a question that asked for none.
 *
 * All forty are intelligence-only. A `proposedAction` or `proposedBatch` here is
 * the agent volunteering a mutation nobody requested, which is the behaviour the
 * authorization model exists to refuse — counted, never tolerated silently.
 */
export const isSpuriousProposal = (a: AgentAnswer | null): boolean => Boolean(a?.proposedAction)

const sum = (rows: readonly CaseResult[], pick: (r: CaseResult) => number | null): number =>
  rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0)

export function tally(rows: readonly CaseResult[], retired: number): Totals {
  const unevaluable = rows.filter(isUnevaluable).length
  return {
    cases: rows.length,
    retired,
    evaluated: rows.length - unevaluable,
    unevaluable,
    answered: rows.filter((r) => r.answered).length,
    unsupportedClaimFailures: rows.filter(isUnsupportedClaimFailure).length,
    groundingFailures: rows.filter(isGroundingFailure).length,
    droppedClaims: sum(rows, (r) => r.droppedClaims),
    strippedRefs: sum(rows, (r) => r.strippedRefs),
    spuriousProposals: rows.filter((r) => r.proposedAction !== null).length,
    spuriousBatches: rows.filter((r) => r.proposedBatch !== null).length,
    todayOnlyBroad: rows.filter(isTodayOnlyBroad).length,
    sawStructuralTool: rows.filter(sawStructural).length,
    deadlineFailures: rows.filter((r) => r.answered === false && r.stopReason === 'deadline').length,
    harnessErrors: rows.filter((r) => r.harnessError !== null).length,
    // Excludes unevaluable: a gate refusal is not a failure of the agent.
    otherFailures: rows.filter(
      (r) =>
        r.answered === false &&
        r.stopReason !== 'deadline' &&
        !isUnsupportedClaimFailure(r) &&
        r.harnessError === null &&
        !isUnevaluable(r),
    ).length,
    roundTrips: sum(rows, (r) => r.timing.toolRoundTrips),
    toolCalls: sum(rows, (r) => r.timing.toolCalls),
    totalMs: sum(rows, (r) => r.timing.totalMs),
    modelWaitMs: sum(rows, (r) => r.timing.modelWaitMs),
    toolWallMs: sum(rows, (r) => r.timing.toolWallMs),
  }
}

/** Latency distribution over whatever actually ran. Never over what was planned. */
export function latency(rows: readonly CaseResult[]): { avg: number; p50: number; p95: number; max: number } {
  const ms = rows.map((r) => r.timing.totalMs).sort((a, b) => a - b)
  if (ms.length === 0) return { avg: 0, p50: 0, p95: 0, max: 0 }
  const at = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]!
  return { avg: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), p50: at(0.5), p95: at(0.95), max: ms[ms.length - 1]! }
}
