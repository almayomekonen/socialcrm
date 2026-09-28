/**
 * What one investigation spent on the outside world. PURE data, counts only.
 *
 * SEPARATE FROM THE BUDGET, AND THAT IS THE POINT. `Budget.stepsUsed()` counts
 * calls that ran OUR code: a local tool's `execute` consults `canStep`, consumes
 * a step, and is audited. A hosted search does none of that — measured, seven
 * provider-executed `web_search` calls arrived inside a single SDK step, so the
 * step counter reported one and the truth was seven.
 *
 * Deriving these numbers from the step counter would therefore be fiction, and
 * the fiction would read as precision. They are counted from the provider's own
 * response instead: `hostedSearchCalls` from the tool calls it reports,
 * `rawSourceRecords` from the sources it returned, and everything after that
 * from what our harvest did with them.
 *
 * NO SCORES, NO AUTHORITY RANKING. There is no `trustScore` here and there will
 * not be one: we cannot compute a source's reliability honestly, and a fabricated
 * number presented beside real counts would be believed. Domains are reported as
 * counts so a reader can judge concentration themselves.
 */

/**
 * Why a research run produced nothing usable. `null` when it produced something.
 *
 * These are DISTINCT OUTCOMES, not shades of failure — the whole reason for the
 * field is that "the search found nothing" and "the search never ran" look
 * identical in an answer and mean opposite things about the product.
 */
export type ResearchFailureReason =
  /** The question never asked about the outside world. Not a failure. */
  | 'not-requested'
  /** Asked, but the resolved provider cannot run the hosted tool. */
  | 'provider-unsupported'
  /** The tool was available and the model chose not to search. */
  | 'no-searches'
  /** Searches ran and the provider returned no source records at all. */
  | 'no-sources'
  /** Sources came back, and none survived normalization or the caps. */
  | 'no-usable-sources'
  /** The run hit its wall clock while research was in flight. */
  | 'deadline'
  /** The provider call threw. */
  | 'provider-error'

export type ResearchTelemetry = {
  /** The rep's own words asked about the outside world. */
  researchRequested: boolean
  /** The hosted tool was actually attached to the model's tool set. */
  researchAdmitted: boolean
  /** Provider-executed search calls, counted from the provider's own tool calls. */
  hostedSearchCalls: number
  /** Source entries the provider returned, before any deduplication. */
  rawSourceRecords: number
  /** Distinct pages after canonical-URL deduplication. */
  uniqueSources: number
  /** Sources that became citable evidence, after the caps. */
  admittedSources: number
  /** Unique sources the caps or the URL rules turned away. */
  rejectedSources: number
  /** Publisher → admitted source count. Concentration, without a score. */
  sourcesByDomain: Record<string, number>
  /** Wall clock for the phase that performed the search. */
  researchWallMs: number
  /** The ceiling that phase was running under. */
  researchDeadlineMs: number
  /** At least one source became evidence. */
  researchHarvested: boolean
  /** SOURCED claims that survived validation. Zero with sources present is a real signal. */
  groundedSourcedClaims: number
  researchFailureReason: ResearchFailureReason | null
}

export const emptyResearchTelemetry = (deadlineMs: number): ResearchTelemetry => ({
  researchRequested: false,
  researchAdmitted: false,
  hostedSearchCalls: 0,
  rawSourceRecords: 0,
  uniqueSources: 0,
  admittedSources: 0,
  rejectedSources: 0,
  sourcesByDomain: {},
  researchWallMs: 0,
  researchDeadlineMs: deadlineMs,
  researchHarvested: false,
  groundedSourcedClaims: 0,
  researchFailureReason: 'not-requested',
})

/**
 * The one outcome, decided in the order the failures actually occur.
 *
 * Earliest cause wins: a run that was never admitted has no searches to report,
 * and calling that `no-searches` would blame the model for a tool it was never
 * given.
 */
export function researchFailureReasonOf(t: {
  researchRequested: boolean
  researchAdmitted: boolean
  hostedSearchCalls: number
  rawSourceRecords: number
  admittedSources: number
  timedOut?: boolean
  providerError?: boolean
}): ResearchFailureReason | null {
  if (!t.researchRequested) return 'not-requested'
  if (!t.researchAdmitted) return 'provider-unsupported'
  if (t.providerError) return 'provider-error'
  if (t.timedOut) return 'deadline'
  if (t.hostedSearchCalls === 0) return 'no-searches'
  if (t.rawSourceRecords === 0) return 'no-sources'
  if (t.admittedSources === 0) return 'no-usable-sources'
  return null
}
