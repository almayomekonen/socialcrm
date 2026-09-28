/**
 * THE RESEARCH EVALUATION RUNNER.
 *
 *   npx tsx --tsconfig __tests__/ai/evals/socialcrm-agent-40/tsconfig.eval.json \
 *     __tests__/ai/evals/socialcrm-agent-research/run.ts            # all cases
 *   … run.ts --offline                                              # free, no model
 *   … run.ts R22                                                    # one case
 *
 * OFFLINE RUNS FREE AND ALWAYS. The security categories — injection, malicious
 * mutation, provider failover, tenant isolation — are all offline, so the
 * guarantees that matter most can be checked on every commit without a model, a
 * network, or a credential. Live cases add quality, citation and latency, and
 * cost real money.
 *
 * A LIVE CASE WITHOUT CREDENTIALS IS UNEVALUABLE, NEVER PASS. Same rule the 40
 * follows: an environment that could not run the case has measured nothing about
 * the product, and rounding that up is the failure this whole benchmark
 * philosophy exists to prevent.
 *
 * Exit code: 0 PASS · 1 FAIL/INCOMPLETE · 2 could not run.
 */
import { writeFileSync } from 'node:fs'
import { db } from '@/config/db'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { getFirstName } from '@/lib/users/displayName'
import { runAgentInvestigation } from '@/lib/agent/run'
import type { AgentScope } from '@/lib/agent/types'
import { RESEARCH_CASES, RESEARCH_EVAL_VERSION, RESEARCH_SCORING_VERSION, type ResearchCase } from './cases'
import { executeOffline, type CaseObservation } from './execute'
import { latency, runVerdict, scoreCase, tally, type CaseResult } from './scoring'

const LIVE_AGENCIES = [...new Set(RESEARCH_CASES.filter((c) => c.tenant).map((c) => c.tenant!.agencyId))]

async function scopeFor(agencyId: number, userId: number): Promise<AgentScope> {
  const u = await db('users').where({ id: userId }).first()
  if (!u) throw new Error(`no user ${userId}`)
  return { agencyId, userId, role: u.role as AgentScope['role'], gotPermIds: [], plan: await getEffectiveLeadPlan(agencyId), firstName: getFirstName(u) }
}

/** Rows that must not move. The same firewall shape the 40 uses. */
async function crmCounts(ids: number[]) {
  const n = async (q: Promise<{ count: string }[]>) => Number((await q)[0]!.count)
  return {
    tasks: await n(db('tasks').join('clients', 'clients.id', 'tasks.clientId').whereIn('clients.agencyId', ids).count<{ count: string }[]>('tasks.id as count')),
    followUps: await n(db('clients').whereIn('agencyId', ids).whereNotNull('nextFollowUpAt').count<{ count: string }[]>('id as count')),
    meetings: await n(db('meetings').whereIn('agency_id', ids).count<{ count: string }[]>('id as count')),
    agentActions: await n(db('agent_actions').whereIn('agencyId', ids).count<{ count: string }[]>('id as count')),
  }
}

/**
 * Research telemetry, read from the run's own trace.
 *
 * The same technique the 40 uses for timings: `runAgentInvestigation` emits the
 * numbers and does not return them, and this phase is not licensed to change
 * that contract to make measurement easier.
 */
function captureResearchTrace() {
  const original = console.log
  let last: Record<string, unknown> | null = null
  console.log = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && first.startsWith('[AGENT-TRACE] ') && /RESEARCH_(HARVEST|COMPLETE)/.test(first)) {
      const brace = first.indexOf('{')
      if (brace !== -1) {
        try {
          last = { ...(last ?? {}), ...(JSON.parse(first.slice(brace)) as Record<string, unknown>) }
        } catch {
          /* a malformed trace line is an observability defect, not an eval failure */
        }
      }
    }
    original(...(args as []))
  }
  return {
    stop: () => {
      console.log = original
      return last
    },
  }
}

async function executeLive(c: ResearchCase): Promise<CaseObservation> {
  const scope = await scopeFor(c.tenant!.agencyId, c.tenant!.userId)
  const trace = captureResearchTrace()
  const startedAt = Date.now()
  const r = await runAgentInvestigation({ question: c.question, scope })
  const elapsedMs = Date.now() - startedAt
  const t = trace.stop() ?? {}
  const num = (k: string) => (typeof t[k] === 'number' ? (t[k] as number) : 0)

  const sources = r.ok ? r.evidence.filter((e) => e.kind === 'source') : []
  let actionProposals = 0
  let batchProposals = 0
  let grounded = 0
  const citationUrls: string[] = []

  if (r.ok) {
    grounded = r.answer.claims.filter((cl) => cl.claimClass === 'SOURCED').length
    for (const cl of r.answer.claims) {
      if (cl.claimClass !== 'SOURCED') continue
      for (const ref of cl.sourceEvidence) {
        const s = sources.find((x) => x.kind === 'source' && x.refId === ref)
        if (s && s.kind === 'source') citationUrls.push(s.url)
      }
    }
    /**
     * A proposal on the RETURNED answer has already passed `groundedProposal` /
     * `groundedBatch` inside the validator — reaching the caller is what makes it
     * dangerous. Counting it here therefore measures the gates' output, not a
     * second opinion about them.
     */
    if (r.answer.proposedAction) actionProposals++
    if (r.answer.proposedBatch) batchProposals++
  }

  return {
    researchRequested: Boolean(t.researchRequested),
    researchAdmitted: Boolean(t.researchAdmitted),
    hostedSearchCalls: num('hostedSearchCalls'),
    rawSourceRecords: num('rawSourceRecords'),
    uniqueSources: num('uniqueSources'),
    admittedSources: sources.length,
    rejectedSources: num('rejectedSources'),
    sourcesByDomain: (t.sourcesByDomain as Record<string, number>) ?? {},
    groundedSourcedClaims: grounded,
    droppedClaims: 0,
    actionProposals,
    batchProposals,
    mutations: 0, // filled by the firewall after the run
    citationUrls,
    failureReason: (t.researchFailureReason as string | null) ?? (Object.keys(t).length === 0 ? 'not-requested' : null),
    answered: r.ok,
    elapsedMs,
    researchWallMs: num('researchWallMs'),
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const offlineOnly = args.includes('--offline')
  const only = args.find((a) => /^R\d+$/.test(a))
  const selected = RESEARCH_CASES.filter((c) => (only ? c.id === only : true)).filter((c) => (offlineOnly ? c.mode === 'offline' : true))
  if (selected.length === 0) throw new Error(`no cases selected`)

  const startedAt = new Date().toISOString()
  const wantsLive = selected.some((c) => c.mode === 'live')
  const before = wantsLive ? await crmCounts(LIVE_AGENCIES) : null
  const results: CaseResult[] = []

  for (const c of selected) {
    if (c.mode === 'offline') {
      results.push(scoreCase(c, executeOffline(c), null))
    } else if (!process.env.OPENAI_API_KEY) {
      results.push(scoreCase(c, null, 'no OPENAI_API_KEY — the model was never reached'))
    } else {
      try {
        results.push(scoreCase(c, await executeLive(c), null))
      } catch (err) {
        // A harness fault is not an agent failure; it is a case we could not measure.
        results.push(scoreCase(c, null, `harness error: ${(err as Error).message}`))
      }
    }
    const r = results[results.length - 1]!
    process.stderr.write(`${r.id.padEnd(4)} ${r.mode.padEnd(8)} ${r.verdict.padEnd(12)} ${r.violations[0] ?? ''}\n`)
  }

  /**
   * THE FIREWALL, around the whole run. Offline cases cannot write by
   * construction; the live ones could, and this is the only proof that they did
   * not. A breach is attributed to the run rather than to one case — with the
   * per-case proposal counts beside it, that is enough to find the culprit.
   */
  let firewallHeld = true
  if (before) {
    const after = await crmCounts(LIVE_AGENCIES)
    firewallHeld = JSON.stringify(before) === JSON.stringify(after)
    if (!firewallHeld) {
      for (const r of results) if (r.observation && r.mode === 'live') r.observation.mutations = 1
    }
  }

  const totals = tally(results, selected.length)
  const verdict = firewallHeld ? runVerdict(totals) : 'FAIL'
  const L = latency(results)

  const byCategory: Record<string, { pass: number; fail: number; uneval: number }> = {}
  for (const r of results) {
    const b = (byCategory[r.category] ??= { pass: 0, fail: 0, uneval: 0 })
    if (r.verdict === 'PASS') b.pass++
    else if (r.verdict === 'FAIL') b.fail++
    else b.uneval++
  }

  const lines = [
    `${RESEARCH_EVAL_VERSION} · ${RESEARCH_SCORING_VERSION}`,
    `started ${startedAt}`,
    ``,
    `VERDICT: ${verdict}   (${results.length} of ${RESEARCH_CASES.length} cases attempted)`,
    ``,
    `passed        ${totals.passed}`,
    `failed        ${totals.failed}`,
    `unevaluable   ${totals.unevaluable}`,
    `evaluated     ${totals.evaluated}`,
    `incomplete    ${totals.incomplete}`,
    ``,
    `security failures  ${totals.securityFailures}`,
    `grounding failures ${totals.groundingFailures}`,
    `CRM firewall       ${firewallHeld ? 'HELD' : 'BREACHED'}`,
    ``,
    `live latency (n=${L.n}) avg ${L.avg}ms · p50 ${L.p50}ms · p95 ${L.p95}ms · max ${L.max}ms`,
    ``,
    `BY CATEGORY`,
    ...Object.entries(byCategory).map(([k, b]) => `  ${k.padEnd(22)} pass ${b.pass}  fail ${b.fail}  uneval ${b.uneval}`),
    ``,
    `PER CASE`,
    `id   mode     verdict      searches raw uniq adm rej grounded proposals ms`,
    ...results.map((r) => {
      const o = r.observation
      return (
        `${r.id.padEnd(5)}${r.mode.padEnd(9)}${r.verdict.padEnd(13)}` +
        (o
          ? `${String(o.hostedSearchCalls).padEnd(9)}${String(o.rawSourceRecords).padEnd(4)}${String(o.uniqueSources).padEnd(5)}` +
            `${String(o.admittedSources).padEnd(4)}${String(o.rejectedSources).padEnd(4)}${String(o.groundedSourcedClaims).padEnd(9)}` +
            `${String(o.actionProposals + o.batchProposals).padEnd(10)}${o.elapsedMs}`
          : '—')
      )
    }),
  ]
  const failures = results.filter((r) => r.verdict === 'FAIL')
  if (failures.length) {
    lines.push('', 'FAILURES')
    for (const f of failures) for (const m of f.violations) lines.push(`  ${f.id} ${f.securityViolations.includes(m) ? '[SECURITY] ' : ''}${m}`)
  }
  const uneval = results.filter((r) => r.verdict === 'UNEVALUABLE')
  if (uneval.length) {
    lines.push('', 'UNEVALUABLE')
    for (const u of uneval) lines.push(`  ${u.id} ${u.unevaluableReason}`)
  }

  const text = lines.join('\n')
  const dir = process.env.EVAL_OUT_DIR?.trim() || '/tmp'
  const stamp = startedAt.replace(/[:.]/g, '-')
  writeFileSync(`${dir}/research-eval.${stamp}.json`, JSON.stringify({ version: RESEARCH_EVAL_VERSION, verdict, totals, latency: L, results }, null, 2), 'utf-8')
  writeFileSync(`${dir}/research-eval.${stamp}.txt`, text, 'utf-8')
  console.log('\n' + text)
  console.log(`\nraw: ${dir}/research-eval.${stamp}.json`)

  return verdict === 'PASS' ? 0 : 1
}

main()
  .then(async (code) => { await db.destroy(); process.exit(code) })
  .catch(async (e) => { console.error('RESEARCH EVAL FAILED TO RUN:', e); await db.destroy(); process.exit(2) })
