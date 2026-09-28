/**
 * THE RUNNER — executes the pinned forty against the real model and real data.
 *
 * Deliberately NOT a vitest test. It costs real money (~$1.30), needs live
 * credentials, and takes ten minutes; a suite that runs on every `npm test`
 * would either be skipped into uselessness or spend the budget by accident.
 * `benchmarkIntegrity.test.ts` is the cheap half that DOES run in CI, and it
 * guards the thing that actually rots: the questions.
 *
 *   npx tsx __tests__/ai/evals/socialcrm-agent-40/run.ts            # all 40
 *   npx tsx __tests__/ai/evals/socialcrm-agent-40/run.ts B8         # one case
 *
 * NO AUTOMATIC RE-RUNS, EVER. A case that hits the 40s deadline is recorded as
 * a deadline failure with its investigation id, model wait, tool wall time and
 * step count, and the run moves on. Retrying until the number improves is how a
 * benchmark becomes a press release.
 */
import { writeFileSync } from 'node:fs'
import { db } from '@/config/db'
import { admitAiRun } from '@/lib/ai/gate'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { getFirstName } from '@/lib/users/displayName'
import { runAgentInvestigation } from '@/lib/agent/run'
import type { AgentScope } from '@/lib/agent/types'
import { ACTIVE_CASES, RETIRED, TENANTS, type BenchmarkCase, type BenchmarkTenant } from './benchmark'
import { compareCounts } from './firewall'
import { crmCounts } from './crmCounts'
import { captureTrace } from './traceCapture'
import { buildReport, formatReport, writeRaw } from './report'
import type { CaseResult } from './scoring'

const AGENCY_IDS = TENANTS.map((t) => t.agencyId)

/**
 * The scope is RESOLVED FROM THE DATABASE, never asserted by the harness.
 *
 * The same door the autonomous path uses. Reading the role and plan back means
 * the benchmark measures the agent under the authority the tenant actually has;
 * a hand-written scope would let the harness quietly grant permissions
 * production would refuse.
 */
async function scopeFor(tenant: BenchmarkTenant): Promise<AgentScope> {
  const user = await db('users').where({ id: tenant.userId }).first()
  if (!user) throw new Error(`benchmark tenant ${tenant.label}: no user ${tenant.userId}`)
  if (user.agencyId !== tenant.agencyId) {
    throw new Error(`benchmark tenant ${tenant.label}: user ${tenant.userId} is not in agency ${tenant.agencyId}`)
  }
  return {
    agencyId: tenant.agencyId,
    userId: tenant.userId,
    role: user.role as AgentScope['role'],
    gotPermIds: [], // every benchmark tenant's user is an ADMIN; getPerms returns [] for admins
    plan: await getEffectiveLeadPlan(tenant.agencyId),
    firstName: getFirstName(user),
  }
}

async function runCase(c: BenchmarkCase, scope: AgentScope): Promise<CaseResult> {
  const toolsUsed: string[] = []
  let dropped = 0
  let stripped = 0
  const trace = captureTrace()
  const startedAt = Date.now()

  try {
    const r = await runAgentInvestigation({
      question: c.question,
      scope,
      onProgress: (e) => toolsUsed.push(e.tool),
      onPersist: async (rec) => {
        dropped = rec.droppedClaims
        stripped = rec.strippedRefs
      },
    })
    const totalMs = Date.now() - startedAt
    const t = trace.stop()
    const timing = { totalMs, modelWaitMs: t.modelWaitMs, toolWallMs: t.toolWallMs, toolCalls: t.toolCalls, toolRoundTrips: t.toolRoundTrips }
    const base = {
      id: c.id, tenantLabel: c.tenant.label, questionIndex: c.questionIndex, question: c.question,
      toolsUsed, droppedClaims: dropped, strippedRefs: stripped, timing, harnessError: null,
    }

    if (r.ok !== true) {
      const f = r as { rejection?: string; rejectionRuleId?: string | null; steps?: number; evidence?: unknown[]; investigationId?: string }
      return {
        ...base, answered: false, stopReason: r.reason, investigationId: f.investigationId ?? null,
        steps: f.steps ?? null, evidenceCount: f.evidence?.length ?? null,
        rejection: f.rejection ?? null, rejectionRuleId: f.rejectionRuleId ?? null,
        businessState: null, headline: null, proposedAction: null, proposedBatch: null,
      }
    }
    return {
      ...base, answered: true, stopReason: r.stopReason, investigationId: r.investigationId,
      steps: r.steps, evidenceCount: r.evidence.length, rejection: null, rejectionRuleId: null,
      businessState: r.answer.businessState ?? null, headline: r.answer.headline,
      proposedAction: r.answer.proposedAction ?? null, proposedBatch: r.answer.proposedBatch ?? null,
    }
  } catch (e) {
    // A harness fault is NOT an agent failure. It is reported as its own
    // category and forces the verdict to INCOMPLETE, never to FAIL or PASS.
    trace.stop()
    return {
      id: c.id, tenantLabel: c.tenant.label, questionIndex: c.questionIndex, question: c.question,
      answered: false, stopReason: 'harness', investigationId: null, steps: null, evidenceCount: null,
      toolsUsed, droppedClaims: dropped, strippedRefs: stripped, rejection: null, rejectionRuleId: null,
      businessState: null, headline: null, proposedAction: null, proposedBatch: null,
      timing: { totalMs: Date.now() - startedAt, modelWaitMs: null, toolWallMs: null, toolCalls: null, toolRoundTrips: null },
      harnessError: (e as Error).message,
    }
  }
}

/**
 * PREFLIGHT — refuse to start a run that cannot produce a valid result.
 *
 * The 2026-09-08 run spent real money and ten minutes discovering, one case at a
 * time, that a tenant's trial had expired the previous day. The information was
 * available before the first token: `admitAiRun` is a cheap, side-effect-free
 * decision, and asking it four times up front is the whole check.
 *
 * REFUSING IS THE POINT. A benchmark that half-runs by default produces numbers
 * that get quoted without their asterisk. Overriding is deliberate and leaves a
 * mark: `EVAL_ALLOW_UNEVALUABLE=1` permits the run, and the verdict is INCOMPLETE
 * no matter how clean the cases that did run turn out to be.
 */
async function preflight(labels: readonly string[]): Promise<string[]> {
  const blocked: string[] = []
  for (const tenant of TENANTS) {
    if (!labels.includes(tenant.label)) continue
    const admission = await admitAiRun({ kind: 'agent.investigate', agencyId: tenant.agencyId })
    if (admission.ok === false) blocked.push(`${tenant.label} (agency ${tenant.agencyId}): ${admission.reason}`)
  }
  return blocked
}

async function main() {
  const only = process.argv[2]
  const cases = only ? ACTIVE_CASES.filter((c) => c.id === only) : ACTIVE_CASES
  if (cases.length === 0) throw new Error(`no such case: ${only}`)

  const blocked = await preflight([...new Set(cases.map((c) => c.tenant.label))])
  if (blocked.length > 0) {
    console.error('PREFLIGHT FAILED — these tenants cannot be evaluated:')
    for (const b of blocked) console.error(`  ${b}`)
    console.error('\nThese cases would be UNEVALUABLE: refused before the agent runs, measuring the')
    console.error('fixture rather than the product. See fixtures/ENTITLEMENT.md for what to restore.')
    if (process.env.EVAL_ALLOW_UNEVALUABLE !== '1') {
      console.error('\nRefusing to run. Set EVAL_ALLOW_UNEVALUABLE=1 to run anyway (verdict will be INCOMPLETE).')
      return 2
    }
    console.error('\nEVAL_ALLOW_UNEVALUABLE=1 — running anyway. The verdict will be INCOMPLETE.')
  }

  const startedAt = new Date().toISOString()
  const before = await crmCounts(AGENCY_IDS)
  const results: CaseResult[] = []

  for (const tenant of TENANTS) {
    const mine = cases.filter((c) => c.tenant.label === tenant.label)
    if (mine.length === 0) continue
    const scope = await scopeFor(tenant)
    for (const c of mine) {
      const r = await runCase(c, scope)
      results.push(r)
      process.stderr.write(
        `${r.id} ${r.answered ? (r.businessState ?? 'null') : `FAILED:${r.rejection ?? r.stopReason}`} ` +
          `${r.timing.totalMs}ms [${r.toolsUsed.join(',') || '—'}]\n`,
      )
    }
  }

  const firewall = compareCounts(before, await crmCounts(AGENCY_IDS))
  const report = buildReport({
    cases: results,
    firewall,
    // The DENOMINATOR IS THE BENCHMARK, not what ran. A partial run reports as
    // partial; see report.ts.
    expectedCases: only ? cases.length : ACTIVE_CASES.length,
    startedAt,
    model: process.env.AGENT_OPENAI_MODEL?.trim() || 'gpt-5.6',
  })

  const stamp = startedAt.replace(/[:.]/g, '-')
  const dir = process.env.EVAL_OUT_DIR?.trim() || '/tmp'
  writeRaw(`${dir}/socialcrm-agent-40.${stamp}.json`, report)
  writeFileSync(`${dir}/socialcrm-agent-40.${stamp}.txt`, formatReport(report), 'utf-8')
  console.log('\n' + formatReport(report))
  console.log(`\nraw: ${dir}/socialcrm-agent-40.${stamp}.json`)
  if (RETIRED.length) console.log(`retired: ${RETIRED.map((r) => `${r.id} (${r.reason})`).join(', ')}`)

  // A FAIL or INCOMPLETE verdict must be visible to a caller that only reads
  // the exit code.
  return report.verdict === 'PASS' ? 0 : 1
}

main()
  .then(async (code) => { await db.destroy(); process.exit(code) })
  .catch(async (e) => { console.error('BENCHMARK FAILED TO RUN:', e); await db.destroy(); process.exit(2) })
