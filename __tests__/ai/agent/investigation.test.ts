/**
 * B6 — persisting one Agent investigation.
 *
 * The row is the only durable record of what the Agent told a rep, so these
 * tests pin what may reach it as hard as they pin that it arrives at all:
 * ONLY validated content is stored, dropped claims never are, and the identity
 * on the row comes from the server-resolved scope rather than anything the
 * caller or the model supplied.
 *
 * Idempotency is enforced by the DATABASE, not by JavaScript, so the conflict
 * target is asserted from generated SQL — a mocked writer would accept any
 * clause. The same is true of tenant scoping on the read.
 *
 * Runs under VITEST_NO_DB=1: readers and the model call are mocked, and the
 * classification table's builder is backed by a real (never-connected) pg
 * builder so `.toSQL()` reflects the statement that would actually run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAgentScope = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
const generateTextSpy = vi.hoisted(() => vi.fn())
const recordAgentInvestigation = vi.hoisted(() => vi.fn())
const agentTrace = vi.hoisted(() => vi.fn())
const buildTodayBrief = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope }))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))
vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))
// Real builders stay real so the SQL assertions bite; only the write is spied.
vi.mock('@/db/agentInvestigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/agentInvestigation')>()
  return { ...actual, recordAgentInvestigation }
})
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextSpy }
})
vi.mock('@/config/db', async () => {
  const knex = (await import('knex')).default
  const sqlOnly = knex({ client: 'pg' })
  return { db: Object.assign((t: string) => sqlOnly(t), { raw: (s: string) => s, fn: { now: () => new Date() } }) }
})

import { askAgent } from '@/actions/ai/askAgent'
import {
  AGENT_INVESTIGATIONS_TABLE,
  agentInvestigationInsertQuery,
  agentInvestigationsQuery,
  buildAgentInvestigationRow,
  type AgentInvestigationInput,
} from '@/db/agentInvestigation'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }
const ADMITTED = {
  ok: true as const,
  cfg: { role: 'primary', maxOutputTokens: 1_200, timeoutMs: 40_000, retryOnSameProvider: 0, providerMaxRetries: 0 },
  effectiveRole: 'primary' as const,
  chain: [{ provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: { id: 'm' } }],
}
const BRIEF = {
  greeting: 'בוקר טוב',
  firstName: 'עלמה',
  items: [{ id: 42, name: 'דוד', state: 'waiting_reply', reason: 'ממתין', targetSurface: 'inbox', phone: '050-0000000' }],
  total: 1,
  remaining: 1,
  handledToday: 0,
  volumeState: 'normal',
  statusVerdict: 'ok',
  meetings: [],
}
const GOOD = {
  headline: 'ליד אחד ממתין לתשובה.',
  claims: [{ claimClass: 'FACT' as const, text: 'דוד ממתין לתשובה.', entityEvidence: ['42'] }],
  unknown: null,
}
const OPTS = { toolCallId: 't', messages: [] } as never

function modelAnswers(answer: unknown = GOOD) {
  return async (args: { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> }) => {
    await args.tools.get_today_state.execute({}, OPTS)
    return { output: answer, totalUsage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'stop', steps: [], text: '', toolCalls: [], toolResults: [] }
  }
}
const persisted = () => recordAgentInvestigation.mock.calls[0]![0] as AgentInvestigationInput

beforeEach(() => {
  // Evidence carries the wall-clock window it was measured over, so two runs
  // milliseconds apart are not comparable. Freeze Date only — timers stay real
  // so the async flow is untouched.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z'))
  resolveAgentScope.mockReset().mockResolvedValue(SCOPE)
  admitAiRun.mockReset().mockResolvedValue(ADMITTED)
  agentTrace.mockReset()
  buildTodayBrief.mockReset().mockResolvedValue(BRIEF)
  recordAgentInvestigation.mockReset().mockResolvedValue(undefined)
  generateTextSpy.mockReset().mockImplementation(modelAnswers())
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Pure row mapping ──────────────────────────────────────────────────────────

describe('buildAgentInvestigationRow', () => {
  const base = (over: Partial<AgentInvestigationInput> = {}): AgentInvestigationInput => ({
    agencyId: 7,
    userId: 3,
    investigationId: 'inv_abc',
    leadId: null,
    question: 'מה דורש טיפול?',
    status: 'answered',
    stopReason: 'answered',
    answer: GOOD,
    evidence: [{ kind: 'lead', refId: '42' }],
    droppedClaims: 2,
    strippedRefs: 1,
    steps: 1,
    failureReason: null,
    ...over,
  })

  it('carries identity, question and outcome', () => {
    const row = buildAgentInvestigationRow(base())
    expect(row).toMatchObject({
      agencyId: 7,
      userId: 3,
      investigationId: 'inv_abc',
      leadId: null,
      question: 'מה דורש טיפול?',
      status: 'answered',
      stopReason: 'answered',
      steps: 1,
      droppedClaims: 2,
      strippedRefs: 1,
    })
  })

  it('serialises the validated answer and evidence as JSON', () => {
    const row = buildAgentInvestigationRow(base())
    expect(JSON.parse(String(row.answer))).toEqual(GOOD)
    expect(JSON.parse(String(row.evidence))).toEqual([{ kind: 'lead', refId: '42' }])
  })

  it('stores a null answer for a failed investigation, never a placeholder', () => {
    const row = buildAgentInvestigationRow(base({ status: 'failed', answer: null, stopReason: 'error', failureReason: 'boom' }))
    expect(row.answer).toBeNull()
    expect(row.failureReason).toBe('boom')
  })

  it('supports a lead-scoped investigation', () => {
    expect(buildAgentInvestigationRow(base({ leadId: 15015 })).leadId).toBe(15015)
  })
})

// ── SQL-level guarantees ──────────────────────────────────────────────────────

describe('database-enforced guarantees', () => {
  it('is first-write-wins on exactly (agencyId, investigationId)', () => {
    const row = buildAgentInvestigationRow({
      agencyId: 7, userId: 3, investigationId: 'inv_abc', leadId: null, question: 'q',
      status: 'answered', stopReason: 'answered', answer: GOOD, evidence: [],
      droppedClaims: 0, strippedRefs: 0, steps: 1, failureReason: null,
    })
    const { sql } = agentInvestigationInsertQuery(row).toSQL()
    expect(sql).toContain(`insert into "${AGENT_INVESTIGATIONS_TABLE}"`)
    expect(sql).toMatch(/on conflict \("agencyId", "investigationId"\) do nothing/)
    expect(sql).not.toMatch(/do update/)
    expect(sql).toContain('"agencyId"')
  })

  it('scopes every read by agencyId and orders newest-first', () => {
    const { sql, bindings } = agentInvestigationsQuery({ agencyId: 7, limit: 20 }).toSQL()
    expect(sql).toMatch(/where "agencyId" = \?/)
    expect(sql).toMatch(/order by "createdAt" desc/)
    expect(sql).toMatch(/limit \?/)
    expect(bindings).toContain(7)
  })

  it('narrows to one rep when a userId is given, still agency-scoped', () => {
    const { sql, bindings } = agentInvestigationsQuery({ agencyId: 7, userId: 3, limit: 5 }).toSQL()
    expect(sql).toMatch(/"agencyId" = \?/)
    expect(sql).toMatch(/"userId" = \?/)
    expect(bindings).toEqual(expect.arrayContaining([7, 3]))
  })
})

// ── Lifecycle through askAgent ────────────────────────────────────────────────

describe('a successful investigation', () => {
  it('persists exactly one row', async () => {
    await askAgent('מה דורש טיפול?')
    expect(recordAgentInvestigation).toHaveBeenCalledTimes(1)
    expect(persisted()).toMatchObject({ status: 'answered', stopReason: 'answered', steps: 1 })
  })

  it('takes agencyId and userId ONLY from the resolved scope', async () => {
    await askAgent('q')
    expect(persisted().agencyId).toBe(7)
    expect(persisted().userId).toBe(3)
  })

  it('persists the rep question and a non-empty investigationId', async () => {
    await askAgent('מה דורש טיפול?')
    expect(persisted().question).toBe('מה דורש טיפול?')
    expect(persisted().investigationId).toMatch(/^inv_/)
  })

  it('persists the validated answer and the evidence the tools produced', async () => {
    await askAgent('q')
    expect(persisted().answer).toEqual(GOOD)
    expect(persisted().evidence).toEqual(expect.arrayContaining([{ kind: 'lead', refId: '42' }]))
  })
})

describe('only validated content reaches the row', () => {
  it('never persists a dropped claim — only its count', async () => {
    generateTextSpy.mockImplementation(
      modelAnswers({
        headline: 'סיכום',
        claims: [
          { claimClass: 'FACT', text: 'דוד ממתין לתשובה.', entityEvidence: ['42'] },
          { claimClass: 'FACT', text: 'INVENTED-CLAIM-TEXT', entityEvidence: ['9999'] },
        ],
        unknown: null,
      }),
    )
    await askAgent('q')
    const p = persisted()
    expect(p.droppedClaims).toBe(1)
    expect(JSON.stringify(p.answer)).not.toContain('INVENTED-CLAIM-TEXT')
    expect(p.answer!.claims).toHaveLength(1)
  })

  it('never persists customer PII the projection stripped', async () => {
    await askAgent('q')
    expect(JSON.stringify(persisted())).not.toContain('050-0000000')
  })
})

describe('failure policy', () => {
  it('an admission denial persists NOTHING', async () => {
    admitAiRun.mockResolvedValue({ ok: false, reason: 'over-quota' })
    const res = await askAgent('q')
    expect(res).toEqual({ ok: false, reason: 'gate_denied', message: 'over-quota' })
    expect(recordAgentInvestigation).not.toHaveBeenCalled()
  })

  it('a provider failure persists the failure state and reason', async () => {
    generateTextSpy.mockRejectedValue(new Error('anthropic 529 overloaded'))
    await askAgent('q')
    expect(recordAgentInvestigation).toHaveBeenCalledTimes(1)
    expect(persisted()).toMatchObject({ status: 'failed', stopReason: 'error', answer: null })
    expect(persisted().failureReason).toContain('overloaded')
  })

  it('a validation rejection persists refusal, never the raw prose', async () => {
    generateTextSpy.mockImplementation(
      modelAnswers({ headline: 'RAW-UNSUPPORTED-PROSE', claims: [{ claimClass: 'FACT', text: 'RAW-CLAIM', entityEvidence: ['9999'] }], unknown: null }),
    )
    await askAgent('q')
    const dump = JSON.stringify(persisted())
    expect(persisted()).toMatchObject({ status: 'refused', stopReason: 'no_evidence', answer: null })
    expect(dump).not.toContain('RAW-UNSUPPORTED-PROSE')
    expect(dump).not.toContain('RAW-CLAIM')
  })

  it('a persistence failure leaves the AgentResult byte-identical', async () => {
    const good = await askAgent('q')
    recordAgentInvestigation.mockReset().mockRejectedValue(new Error('relation does not exist'))
    generateTextSpy.mockImplementation(modelAnswers())
    const withFailure = await askAgent('q')
    expect(withFailure).toEqual(good)
    expect(withFailure).toMatchObject({ ok: true })
  })
})

describe('idempotency and concurrency', () => {
  it('two investigations by the same rep get distinct ids, so both persist', async () => {
    await askAgent('first')
    await askAgent('second')
    expect(recordAgentInvestigation).toHaveBeenCalledTimes(2)
    const a = (recordAgentInvestigation.mock.calls[0]![0] as AgentInvestigationInput).investigationId
    const b = (recordAgentInvestigation.mock.calls[1]![0] as AgentInvestigationInput).investigationId
    expect(a).not.toBe(b)
    expect(a).toMatch(/^inv_/)
  })

  it('a replayed investigationId collides on the unique key, so the DB keeps the first', () => {
    // The guarantee is the DB's; JS never dedupes. The conflict target above is
    // what enforces it, and this pins that the key is built from the row.
    const mk = (id: string) =>
      buildAgentInvestigationRow({
        agencyId: 7, userId: 3, investigationId: id, leadId: null, question: 'q',
        status: 'answered', stopReason: 'answered', answer: GOOD, evidence: [],
        droppedClaims: 0, strippedRefs: 0, steps: 1, failureReason: null,
      })
    expect([mk('inv_x').agencyId, mk('inv_x').investigationId]).toEqual([7, 'inv_x'])
    expect(mk('inv_y').investigationId).toBe('inv_y')
  })
})
