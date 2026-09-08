/**
 * THE REPORT — deterministic, and honest about what it does not know.
 *
 * Two rules govern every line below.
 *
 * NEVER ROUND AN INCOMPLETE RUN TO A PASSING SCORE. If thirty-eight of forty
 * ran, the headline says 38/40 and the verdict is INCOMPLETE — never "38/38
 * answered". A benchmark that reports the denominator it managed is measuring
 * its own convenience.
 *
 * RAW RESULTS SURVIVE. `writeRaw` persists every per-case record next to the
 * summary, because the summary is the part that will be wrong first, and a
 * number nobody can re-derive is a number nobody should trust.
 *
 * NEVER PERSIST REJECTED PROSE. A refused answer's text is destroyed by the
 * runtime by design; this file records the rule that fired and the counts, and
 * never reconstructs what the model tried to say.
 */
import { writeFileSync } from 'node:fs'
import { BENCHMARK_VERSION, RETIRED } from './benchmark'
import { SCORING_VERSION, latency, tally, type CaseResult } from './scoring'
import type { FirewallVerdict } from './firewall'

export type RunVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE'

export type BenchmarkReport = {
  benchmarkVersion: string
  scoringVersion: string
  startedAt: string
  model: string
  expectedCases: number
  verdict: RunVerdict
  totals: ReturnType<typeof tally>
  latencyMs: ReturnType<typeof latency>
  firewall: FirewallVerdict
  failures: { id: string; reason: string; detail: string }[]
  cases: CaseResult[]
}

/**
 * The verdict, in the order the failures actually matter.
 *
 * A firewall breach outranks everything: an evaluation that changed the data it
 * was measuring has invalidated its own numbers, whatever they say.
 */
export function verdictFor(report: Omit<BenchmarkReport, 'verdict'>): RunVerdict {
  if (report.firewall.ok === false) return 'FAIL'
  if (report.totals.cases < report.expectedCases) return 'INCOMPLETE'
  if (report.totals.harnessErrors > 0) return 'INCOMPLETE'
  const t = report.totals
  const clean =
    t.answered === t.cases &&
    t.unsupportedClaimFailures === 0 &&
    t.groundingFailures === 0 &&
    t.droppedClaims === 0 &&
    t.strippedRefs === 0 &&
    t.spuriousProposals === 0 &&
    t.spuriousBatches === 0 &&
    t.deadlineFailures === 0
  return clean ? 'PASS' : 'FAIL'
}

export function buildReport(input: {
  cases: CaseResult[]
  firewall: FirewallVerdict
  expectedCases: number
  startedAt: string
  model: string
}): BenchmarkReport {
  const totals = tally(input.cases, RETIRED.length)
  const failures = input.cases
    .filter((c) => c.answered === false || c.harnessError !== null || c.droppedClaims > 0 || c.strippedRefs > 0)
    .map((c) => ({
      id: c.id,
      reason: c.harnessError ? 'harness-error' : c.answered ? 'grounding' : (c.rejection ?? c.stopReason),
      // Everything a claim-gate failure needs to be diagnosed, and no prose.
      detail:
        `rule=${c.rejectionRuleId ?? '—'} dropped=${c.droppedClaims} stripped=${c.strippedRefs} ` +
        `evidence=${c.evidenceCount ?? '—'} finish=${c.stopReason} steps=${c.steps ?? '—'} ` +
        `modelWait=${c.timing.modelWaitMs ?? '—'}ms toolWall=${c.timing.toolWallMs ?? '—'}ms ` +
        `inv=${c.investigationId ?? '—'}`,
    }))

  const partial = { ...input, benchmarkVersion: BENCHMARK_VERSION, scoringVersion: SCORING_VERSION, totals, latencyMs: latency(input.cases), failures }
  return { ...partial, verdict: verdictFor(partial) }
}

export function formatReport(r: BenchmarkReport): string {
  const t = r.totals
  const L = r.latencyMs
  const pct = (n: number) => `${n}/${t.cases}`
  const lines = [
    `${r.benchmarkVersion} · ${r.scoringVersion} · model ${r.model}`,
    `started ${r.startedAt}`,
    ``,
    `VERDICT: ${r.verdict}   (${t.cases} of ${r.expectedCases} cases ran${t.retired ? `, ${t.retired} retired` : ''})`,
    ``,
    `answered                  ${pct(t.answered)}`,
    `unsupported-claim failures ${t.unsupportedClaimFailures}`,
    `grounding failures         ${t.groundingFailures}`,
    `dropped claims             ${t.droppedClaims}`,
    `stripped refs              ${t.strippedRefs}`,
    `spurious proposals         ${t.spuriousProposals}`,
    `spurious batches           ${t.spuriousBatches}`,
    `Today-only broad           ${t.todayOnlyBroad}`,
    `saw a structural tool      ${pct(t.sawStructuralTool)}`,
    `deadline failures          ${t.deadlineFailures}`,
    `harness errors             ${t.harnessErrors}`,
    `other failures             ${t.otherFailures}`,
    ``,
    `round trips ${t.roundTrips} · tool calls ${t.toolCalls}`,
    `latency avg ${L.avg}ms · p50 ${L.p50}ms · p95 ${L.p95}ms · max ${L.max}ms`,
    `model wait ${t.modelWaitMs}ms · tool wall ${t.toolWallMs}ms (totals across all cases)`,
    ``,
    `CRM FIREWALL: ${r.firewall.ok ? 'HELD' : 'BREACHED'}`,
    `  before ${JSON.stringify(r.firewall.before)}`,
    `  after  ${JSON.stringify(r.firewall.after)}`,
    ...r.firewall.breaches.map((b) => `  !! ${b.table}: ${b.before} → ${b.after}`),
  ]
  if (r.failures.length) {
    lines.push('', 'FAILURES')
    for (const f of r.failures) lines.push(`  ${f.id} ${f.reason}`, `     ${f.detail}`)
  }
  lines.push('', 'PER CASE', 'id    state       ms     tools')
  for (const c of r.cases) {
    lines.push(
      `${c.id.padEnd(6)}${(c.businessState ?? (c.answered ? 'null' : 'FAILED')).padEnd(12)}` +
        `${String(c.timing.totalMs).padEnd(7)}${c.toolsUsed.join(',') || '—'}`,
    )
  }
  return lines.join('\n')
}

/** The raw records, so any number above can be re-derived without a re-run. */
export function writeRaw(path: string, report: BenchmarkReport): void {
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8')
}
