import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Roles } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

/**
 * Agent run identity END TO END, against a real PostgreSQL:
 *
 *   POST /api/ai/agent/stream → askAgent → runAgentInvestigation
 *   runSignalWorker → admitInvestigation → runAgentInvestigation
 *
 * The real route, server action, worker, admission, Agent runtime, usage
 * ledger and shadow reservations run. Mocked only at the boundaries: the
 * provider SDK, the session, the model chain, and the worker's job store /
 * admission side-effects. Proves the SERVER-generated investigation id is the
 * run of every provider call (ledger rows and reservations), investigations
 * stay isolated, nothing reports a missing identity, and a client-supplied id
 * or tenant is ignored.
 */
const generateText = vi.hoisted(() => vi.fn())
vi.mock('ai', async (i) => ({ ...(await i<typeof import('ai')>()), generateText }))
vi.mock('@/lib/ai/gate', () => ({
  AGENT_TASK_KIND: 'agent.investigate',
  admitAiRun: async () => ({
    ok: true,
    effectiveRole: 'primary',
    cfg: { role: 'primary', maxOutputTokens: 1200, providerMaxRetries: 0 },
    chain: [{ provider: 'openai', modelId: 'gpt-5.6-sol', model: { id: 'm' } }],
  }),
}))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))

const AGENCY = 9611
const SCOPE: AgentScope = { agencyId: AGENCY, userId: 7, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' }

// The /agent route's session boundary.
vi.mock('@/lib/requireUser', async (i) => ({
  ...(await i<typeof import('@/lib/requireUser')>()),
  requireProductAccess: async () => ({ id: 7, agencyId: AGENCY, role: 'ADMIN' }),
}))
vi.mock('@/lib/ai/flags', async (i) => ({ ...(await i<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => true }))
vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope: async () => SCOPE }))
vi.mock('@/db/agentInvestigation', async (i) => ({
  ...(await i<typeof import('@/db/agentInvestigation')>()),
  recordAgentInvestigation: vi.fn(),
}))
vi.mock('@/lib/agent/actions/bridge', () => ({
  submitProposedAction: vi.fn(),
  submitProposedBatch: vi.fn(),
  decideOnAction: vi.fn(),
  decideOnBatch: vi.fn(),
}))

// Investigation admission's side-effects (its own preconditions, money hold and records).
vi.mock('@/lib/ai/integration/preconditions', async (i) => ({
  ...(await i<typeof import('@/lib/ai/integration/preconditions')>()),
  checkPreconditions: async () => ({ proceed: true, scope: SCOPE, state: {}, operatorUserId: 7, value: {} }),
}))
vi.mock('@/db/ai/spendReservations', () => ({
  reserve: async () => ({ reserved: true, row: { id: 1 } }),
  release: async () => undefined,
  settle: async () => undefined,
  releaseExpired: async () => 0,
  isReservationActive: async () => true,
}))
vi.mock('@/lib/ai/integration/investigationBridge', () => ({ bridgeInvestigation: () => ({}) }))
vi.mock('@/lib/ai/runtime/toolAction', async (i) => ({
  ...(await i<typeof import('@/lib/ai/runtime/toolAction')>()),
  decide: () => ({ emitted: false }),
}))
vi.mock('@/db/ai/investigations', () => ({ recordInvestigation: vi.fn() }))
vi.mock('@/db/ai/shadowCoverage', () => ({ recordCoverageDecision: vi.fn() }))
vi.mock('@/lib/ai/integration/insightEmit', () => ({ emitInsight: vi.fn() }))

import { db } from '@/config/db'
import { POST } from '@/app/api/ai/agent/stream/route'
import { runSignalWorker } from '@/lib/ai/integration/signalWorker'
import type { SignalJob } from '@/db/ai/signalJobs'

const ANSWER = { headline: 'h', claims: [], unknown: 'לא ידוע' }
let stepSeq = 0
const step = () => ({
  usage: {
    inputTokens: 1_000,
    outputTokens: 100,
    inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
  response: { id: `s${++stepSeq}`, modelId: 'gpt-5.6-sol' },
  providerMetadata: { openai: { serviceTier: 'default' } },
  finishReason: 'stop',
})
const done = (n: number, extra: Record<string, unknown> = { output: ANSWER }) => ({
  ...extra,
  steps: Array.from({ length: n }, step),
  totalUsage: { inputTokens: 1_000 * n, outputTokens: 100 * n },
  finishReason: 'stop',
  response: { messages: [] },
})

const reservations = () => db('ai_budget_reservations').where({ agencyId: AGENCY }).orderBy('id')
const ledger = () => db('ai_usage_events').where({ agencyId: AGENCY }).orderBy('id')
const settled = async () => {
  for (let i = 0; i < 40; i++) {
    const open = await db('ai_budget_reservations')
      .where({ agencyId: AGENCY, state: 'reserved' })
      .count<{ count: string }>('* as count')
      .first()
    if (Number(open?.count) === 0) return
    await new Promise((r) => setTimeout(r, 25))
  }
}
const groups = (rows: { operationId: string }[]) => [...new Set(rows.map((r) => r.operationId))]

let warn: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  process.env.AI_BUDGET_SHADOW = '1'
  process.env.AI_USAGE_LEDGER = '1'
  generateText.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  for (const k of ['AI_BUDGET_SHADOW', 'AI_USAGE_LEDGER', 'SIGNAL_INVESTIGATE_AGENCY_IDS']) delete process.env[k]
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
  await db('ai_budget_counters').where('scopeKey', 'like', `%${AGENCY}%`).del()
})
const noMissingIdentity = () =>
  expect(warn.mock.calls.filter((c) => c[0] === '[ai-budget]' && String(c[1]).includes('run_identity_missing'))).toHaveLength(0)

async function ask(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest('http://localhost/api/ai/agent/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  const text = await res.text()
  const answer = /event: answer\ndata: (.*)\n/.exec(text)
  expect(answer).not.toBeNull()
  return JSON.parse(answer![1]) as { investigationId: string }
}

describe('/agent stream route → askAgent → Agent runtime', () => {
  it('every step of one question is one run: the server-generated investigation id, in the ledger AND the reservation', async () => {
    generateText.mockResolvedValueOnce(done(3))
    const answer = await ask({ question: 'מה קורה עם הלידים?' })
    await settled()
    expect(answer.investigationId).toMatch(/^inv_/)
    const rows = await ledger()
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => [r.operationKind, r.operationId])).toEqual(
      Array(3).fill(['agent_investigation', answer.investigationId]),
    )
    const [r] = await reservations()
    expect(r).toMatchObject({ operationKind: 'agent_investigation', operationId: answer.investigationId, stepCount: 3 })
    expect(r.scopesSkipped).not.toContain('run')
    noMissingIdentity()
  })

  it('separate questions are separate runs', async () => {
    generateText.mockResolvedValueOnce(done(1)).mockResolvedValueOnce(done(1))
    const a = await ask({ question: 'שאלה ראשונה' })
    const b = await ask({ question: 'שאלה שנייה' })
    await settled()
    expect(a.investigationId).not.toBe(b.investigationId)
    expect(groups(await reservations())).toEqual([a.investigationId, b.investigationId])
    for (const id of [a.investigationId, b.investigationId]) {
      const c = await db('ai_budget_counters')
        .where({ scopeKey: `run:a${AGENCY}:agent_investigation:${id}`, windowKind: 'run' })
        .first()
      expect(c.requests).toBe(1)
    }
  })

  it('client-supplied identifiers are ignored: the run and the tenant come from the server', async () => {
    generateText.mockResolvedValueOnce(done(1))
    const answer = await ask({ question: 'q', investigationId: 'inv_chosen_by_client', agencyId: 1, operationId: 'x' })
    await settled()
    expect(answer.investigationId).not.toBe('inv_chosen_by_client')
    const [r] = await reservations() // found under the SESSION's agency
    expect(r.operationId).toBe(answer.investigationId)
    expect(await db('ai_budget_reservations').where({ operationId: 'inv_chosen_by_client' })).toHaveLength(0)
    expect(await db('ai_budget_reservations').where({ agencyId: 1, operationId: answer.investigationId })).toHaveLength(0)
  })
})

describe('signal worker → investigation admission → Agent runtime', () => {
  const job = (id: number): SignalJob =>
    ({
      id,
      agencyId: AGENCY,
      observationKey: `obs-${id}`,
      expectation: 'followup.overdue',
      subjectType: 'lead',
      subjectId: String(500 + id),
      signal: {},
      status: 'leased',
      attempts: 1,
      maxAttempts: 3,
      detectedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }) as unknown as SignalJob

  it('each autonomous investigation is one run across both phases and all steps; investigations stay isolated', async () => {
    process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = String(AGENCY)
    // Two investigations × (evidence phase with 2 steps, answer phase with 1).
    generateText
      .mockResolvedValueOnce(done(2, { text: 'p1' }))
      .mockResolvedValueOnce(done(1))
      .mockResolvedValueOnce(done(2, { text: 'p1' }))
      .mockResolvedValueOnce(done(1))
    let batches = [[job(1), job(2)]]
    const summary = await runSignalWorker({
      deps: {
        claim: async () => batches.shift() ?? [],
        reclaim: async () => 0,
        interpret: (() => ({ accepted: true, event: {} })) as never,
        succeed: vi.fn(),
        fail: vi.fn(),
        deadLetter: vi.fn(),
        releaseClaim: vi.fn(),
      },
    })
    await settled()
    expect(summary.investigated).toBe(2)

    const rows = await ledger()
    const runs = groups(rows)
    expect(runs).toHaveLength(2)
    for (const id of runs) {
      expect(id).toMatch(/^inv_/)
      expect(rows.filter((r) => r.operationId === id)).toHaveLength(3) // 2 + 1 steps, one run
    }
    const res = await reservations()
    expect(res.map((r) => r.operationId)).toEqual([runs[0], runs[0], runs[1], runs[1]]) // two phases each
    expect(res.every((r) => r.operationKind === 'agent_investigation')).toBe(true)
    for (const id of runs) {
      const c = await db('ai_budget_counters')
        .where({ scopeKey: `run:a${AGENCY}:agent_investigation:${id}`, windowKind: 'run' })
        .first()
      expect(c.requests).toBe(2)
    }
    noMissingIdentity()
    batches = []
  })
})
