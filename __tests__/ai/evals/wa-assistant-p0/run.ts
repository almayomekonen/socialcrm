/**
 * THE RUNNER — the WhatsApp assistant regression set against the real model.
 *
 * Not a vitest test, for the reason socialcrm-agent-40/run.ts gives: it costs
 * real money (~$1–2), needs live credentials, and takes minutes. `cases.test.ts`
 * is the half that runs in CI.
 *
 *   npx tsx --tsconfig __tests__/ai/evals/socialcrm-agent-40/tsconfig.eval.json \
 *     --env-file=.env.local __tests__/ai/evals/wa-assistant-p0/run.ts <label> [caseId | kind]
 *
 * WHAT IT RUNS IS WHAT THE OWNER RECEIVES. The Agent is called with the WhatsApp
 * worker's own options (read tools only, no web research, the worker's step and
 * time limits), and the reply is built by the worker's own functions
 * (`replyForAnswer`, `failureReply`). Identity, limits and the meeting card are
 * the worker's and are not exercised here; meetings are off for the tenant.
 *
 * ONE RUN PER CASE, NO RE-RUNS. A bad answer is recorded, not retried.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { db } from '@/config/db'
import { admitAiRun } from '@/lib/ai/gate'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { getFirstName } from '@/lib/users/displayName'
import { runAgentInvestigation } from '@/lib/agent/run'
import type { AgentScope } from '@/lib/agent/types'
import { WA_ASSISTANT_LIMITS } from '@/lib/flags/waAssistantFlags'
import { APP_LINK, COPY, NO_ACTIONS_NOTE, failureReply, replyForAnswer } from '@/lib/waAssistant/render'
import { CASES, DOCUMENTED_FAILURES, type EvalCase } from './cases'

/** Tenant C of socialcrm-agent-40: an admin on a paid plan with no expiry (fixtures/ENTITLEMENT.md). */
const TENANT = { agencyId: 41, userId: 183 }

type Result = {
  id: string
  kind: EvalCase['kind']
  question: string
  ok: boolean
  stopReason: string
  rejection: string | null
  tools: string[]
  droppedClaims: number
  claimClasses: string[]
  businessState: string | null
  reply: string
  /** The validated answer, so a renderer change can be replayed without the model. */
  answer: unknown
  costUsd: number
  ms: number
  checks: { fallback: boolean; refused: boolean; tooManyTools: boolean; notPlain: boolean; patternFailures: string[] }
  pass: boolean
}

const FALLBACKS: readonly string[] = [COPY.noAnswer, COPY.failed, COPY.timeout, COPY.notAvailable]

/** A plain message: no bold report headline, no bullets, no app link. */
const isPlain = (reply: string) => !reply.startsWith('*') && !/^• /m.test(reply) && !reply.includes(APP_LINK)

async function scope(): Promise<AgentScope> {
  const user = await db('users').where({ id: TENANT.userId }).first()
  if (!user || user.agencyId !== TENANT.agencyId) throw new Error('eval tenant user missing or in another agency')
  return {
    agencyId: TENANT.agencyId,
    userId: TENANT.userId,
    role: user.role as AgentScope['role'],
    gotPermIds: [], // the tenant's user is an ADMIN
    plan: await getEffectiveLeadPlan(TENANT.agencyId),
    firstName: getFirstName(user),
  }
}

async function runCase(c: EvalCase, s: AgentScope): Promise<Result> {
  const tools: string[] = []
  let dropped = 0
  const startedAt = Date.now()
  const r = await runAgentInvestigation({
    question: c.question.trim().slice(0, WA_ASSISTANT_LIMITS.maxQuestionChars),
    history: c.history ? [...c.history] : [],
    scope: s,
    maxSteps: WA_ASSISTANT_LIMITS.maxSteps,
    deadlineMs: WA_ASSISTANT_LIMITS.deadlineMs,
    disableResearch: true,
    skipInteractiveSpend: true,
    onProgress: (e) => tools.push(e.tool),
    onPersist: async (rec) => {
      dropped = rec.droppedClaims
    },
  })
  const ms = Date.now() - startedAt
  const f = r as { rejection?: string; rejectionRuleId?: string | null }
  const reply =
    r.ok === true
      ? replyForAnswer(r.answer, { note: r.answer.proposedAction || r.answer.proposedBatch ? NO_ACTIONS_NOTE : null }).text
      : failureReply(r.reason)

  const patternFailures = [
    ...(c.mustMatch ?? []).filter((p) => !p.test(reply)).map((p) => `missing ${p}`),
    ...(c.mustNotMatch ?? []).filter((p) => p.test(reply)).map((p) => `has ${p}`),
  ]
  const checks = {
    fallback: FALLBACKS.some((t) => reply.startsWith(t)),
    refused: r.ok !== true && f.rejection === 'unsupported-claim',
    tooManyTools: c.maxTools !== undefined && tools.length > c.maxTools,
    notPlain: c.plain === true && !isPlain(reply),
    patternFailures,
  }
  return {
    id: c.id,
    kind: c.kind,
    question: c.question,
    ok: r.ok === true,
    stopReason: r.ok === true ? r.stopReason : r.reason,
    rejection: r.ok === true ? null : [f.rejection, f.rejectionRuleId].filter(Boolean).join('/') || null,
    tools,
    droppedClaims: dropped,
    claimClasses: r.ok === true ? r.answer.claims.map((x) => x.claimClass) : [],
    businessState: r.ok === true ? (r.answer.businessState ?? null) : null,
    reply,
    answer: r.ok === true ? r.answer : null,
    costUsd: r.costUsd ?? 0,
    ms,
    checks,
    pass: !checks.fallback && !checks.refused && !checks.tooManyTools && !checks.notPlain && patternFailures.length === 0,
  }
}

function report(label: string, results: Result[], startedAt: string): string {
  const n = (p: (r: Result) => boolean) => results.filter(p).length
  const kinds = [...new Set(results.map((r) => r.kind))]
  const oneLine = (s: string) => s.replace(/\n+/g, ' ⏎ ').replace(/\|/g, '\\|')
  const flags = (r: Result) =>
    [
      r.checks.fallback && 'FALLBACK',
      r.checks.refused && `REFUSED(${r.rejection})`,
      r.checks.tooManyTools && 'TOOLS',
      r.checks.notPlain && 'FORMAT',
      ...r.checks.patternFailures,
    ]
      .filter(Boolean)
      .join('; ')
  const lines = [
    `# wa-assistant-p0 — ${label}`,
    '',
    `Run ${startedAt} · tenant agency ${TENANT.agencyId} · model ${process.env.AGENT_OPENAI_MODEL?.trim() || 'gpt-5.6'} · ${results.length} cases`,
    '',
    '| metric | count |',
    '| --- | --- |',
    `| passed every check | ${n((r) => r.pass)} / ${results.length} |`,
    `| generic fallback sent | ${n((r) => r.checks.fallback)} |`,
    `| refused as unsupported claim | ${n((r) => r.checks.refused)} |`,
    `| dropped claims (sum) | ${results.reduce((a, r) => a + r.droppedClaims, 0)} |`,
    `| unnecessary tool calls (cases over their limit) | ${n((r) => r.checks.tooManyTools)} |`,
    `| report format where a plain reply was expected | ${n((r) => r.checks.notPlain)} |`,
    `| content pattern failures | ${n((r) => r.checks.patternFailures.length > 0)} |`,
    `| cost | $${results.reduce((a, r) => a + r.costUsd, 0).toFixed(3)} |`,
    '',
    '| kind | passed |',
    '| --- | --- |',
    ...kinds.map((k) => `| ${k} | ${n((r) => r.kind === k && r.pass)} / ${n((r) => r.kind === k)} |`),
    '',
    `Documented failures: ${Object.entries(DOCUMENTED_FAILURES)
      .map(([k, id]) => `${k}=${id} ${results.find((r) => r.id === id)?.pass ? 'PASS' : 'FAIL'}`)
      .join(' · ')}`,
    '',
    '| id | pass | tools | claims | flags | question | reply |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.pass ? 'yes' : '**no**'} | ${r.tools.join(',') || '—'} | ${r.claimClasses.join(',') || '—'} | ${oneLine(flags(r)) || '—'} | ${oneLine(r.question)} | ${oneLine(r.reply)} |`,
    ),
  ]
  return lines.join('\n') + '\n'
}

async function main() {
  const label = process.argv[2]
  if (!label) throw new Error('usage: run.ts <label> [caseId | kind]')
  const only = process.argv[3]
  const cases = only ? CASES.filter((c) => c.id === only || c.kind === only) : CASES
  if (!cases.length) throw new Error(`no such case: ${only}`)

  const admission = await admitAiRun({ kind: 'agent.investigate', agencyId: TENANT.agencyId })
  if (admission.ok === false) throw new Error(`tenant not evaluable: ${admission.reason}`)

  const s = await scope()
  const startedAt = new Date().toISOString()
  const results: Result[] = []
  for (const c of cases) {
    const r = await runCase(c, s)
    results.push(r)
    process.stderr.write(`${r.id} ${r.pass ? 'pass' : 'FAIL'} ${r.ms}ms [${r.tools.join(',') || '—'}]\n`)
  }

  const dir = `${process.cwd()}/__tests__/ai/evals/wa-assistant-p0/results`
  mkdirSync(dir, { recursive: true })
  const stamp = startedAt.slice(0, 10)
  writeFileSync(`${dir}/${stamp}-${label}.md`, report(label, results, startedAt), 'utf-8')
  writeFileSync(`${dir}/${stamp}-${label}.json`, JSON.stringify({ label, startedAt, results }, null, 1) + '\n', 'utf-8')
  console.log(report(label, results, startedAt))
  return 0
}

main()
  .then(async (code) => {
    await db.destroy()
    process.exit(code)
  })
  .catch(async (e) => {
    console.error('EVAL FAILED TO RUN:', e)
    await db.destroy()
    process.exit(2)
  })
