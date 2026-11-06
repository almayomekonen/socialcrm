/**
 * `list_meetings` is switched on per agency (AGENT_LIST_MEETINGS_AGENCY_IDS),
 * absent = off, on every surface the Agent runs on. Checked server-side, from
 * the authenticated scope, in three places:
 *   1. the tool is not registered for a disabled agency (lib/agent/tools/index.ts);
 *   2. the prompt's meetings rule is not shown to it (lib/agent/run.ts → prompt);
 *   3. the tool, if ever built for a disabled agency, reads nothing.
 *
 * Runs under VITEST_NO_DB=1 — every reader and the model call are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAgentScope = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
const generateTextSpy = vi.hoisted(() => vi.fn())
const listOrganizerMeetings = vi.hoisted(() => vi.fn())
const buildTodayBrief = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope }))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))
vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/db/agentMeetings', () => ({ listOrganizerMeetings }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextSpy }
})

import { isAgentListMeetingsAgency } from '@/lib/flags/agentMeetingsFlags'
import { buildAgentTools } from '@/lib/agent/tools'
import { makeListMeetings } from '@/lib/agent/tools/listMeetings'
import { AGENT_SYSTEM_PROMPT, LIST_MEETINGS_RULE, agentDateContext, buildAgentSystemPrompt } from '@/lib/agent/prompt'
import { runAgentInvestigation } from '@/lib/agent/run'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const ENV = 'AGENT_LIST_MEETINGS_AGENCY_IDS'
const ALLOWED = 7
const OTHER = 8
const scopeOf = (agencyId: number): AgentScope => ({ agencyId, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ע' })
const deps = (agencyId: number) => ({
  scope: scopeOf(agencyId),
  evidence: createEvidenceCollector(),
  budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
  nowMs: Date.UTC(2026, 10, 6, 10),
})
const OPTS = { toolCallId: 't1', messages: [] } as never
const NOW = Date.UTC(2026, 10, 6, 10)

let saved: string | undefined
beforeEach(() => {
  saved = process.env[ENV]
  delete process.env[ENV]
  listOrganizerMeetings.mockReset().mockResolvedValue({ rows: [], truncated: false })
})
afterEach(() => {
  if (saved === undefined) delete process.env[ENV]
  else process.env[ENV] = saved
})

describe('the switch', () => {
  it('is off by default: unset or empty enables no agency', () => {
    expect(isAgentListMeetingsAgency(ALLOWED)).toBe(false)
    process.env[ENV] = ''
    expect(isAgentListMeetingsAgency(ALLOWED)).toBe(false)
  })

  it('enables exactly the listed ids, and nothing else', () => {
    process.env[ENV] = ` ${ALLOWED} , 103`
    expect(isAgentListMeetingsAgency(ALLOWED)).toBe(true)
    expect(isAgentListMeetingsAgency(103)).toBe(true)
    expect(isAgentListMeetingsAgency(OTHER)).toBe(false)
    expect(isAgentListMeetingsAgency(null)).toBe(false)
    expect(isAgentListMeetingsAgency(0)).toBe(false)
  })

  it('has no wildcard: "all", "*" and malformed ids enable nobody', () => {
    for (const raw of ['all', '*', '7x', '-7', '7.0']) {
      process.env[ENV] = raw
      expect(isAgentListMeetingsAgency(ALLOWED), raw).toBe(false)
    }
  })
})

describe('tool registration', () => {
  it('disabled: the tool is not registered; the other ten are', () => {
    const names = Object.keys(buildAgentTools(deps(ALLOWED)))
    expect(names).not.toContain('list_meetings')
    expect(names).toHaveLength(10)
  })

  it('enabled for the listed agency: registered', () => {
    process.env[ENV] = String(ALLOWED)
    expect(Object.keys(buildAgentTools(deps(ALLOWED)))).toContain('list_meetings')
  })

  it("another agency's switch does not enable this one", () => {
    process.env[ENV] = String(OTHER)
    expect(Object.keys(buildAgentTools(deps(ALLOWED)))).not.toContain('list_meetings')
  })
})

describe('the prompt', () => {
  it('disabled: exactly the stable prompt plus the date, with no mention of list_meetings', () => {
    const p = buildAgentSystemPrompt(NOW)
    expect(p).toBe(`${AGENT_SYSTEM_PROMPT}\n\n${agentDateContext(NOW)}`)
    expect(p).not.toContain('list_meetings')
  })

  it('enabled: the meetings rule sits at the end of section 3', () => {
    const p = buildAgentSystemPrompt(NOW, { listMeetings: true })
    expect(p).toContain(`רק כאן וב-4 טענות עובדתיות דורשות אסמכתת CRM.\n${LIST_MEETINGS_RULE}\n`)
  })
})

describe('the tool itself refuses for a disabled agency', () => {
  it('built for a disabled agency, executing it reads nothing', async () => {
    const t = makeListMeetings(deps(ALLOWED))
    const out = await t.execute!({ period: 'today' }, OPTS)
    expect(out).toMatchObject({ refused: true })
    expect(listOrganizerMeetings).not.toHaveBeenCalled()
  })

  it('enabled: it reads, pinned to the scope agency and user', async () => {
    process.env[ENV] = String(ALLOWED)
    const out = await makeListMeetings(deps(ALLOWED)).execute!({ period: 'today' }, OPTS)
    expect(out).toMatchObject({ count: 0 })
    expect(listOrganizerMeetings).toHaveBeenCalledWith(expect.objectContaining({ agencyId: ALLOWED, organizerUserId: 3 }))
  })
})

describe('a full investigation', () => {
  const ADMITTED = {
    ok: true as const,
    cfg: { role: 'primary', maxOutputTokens: 1_200, timeoutMs: 40_000, retryOnSameProvider: 0, providerMaxRetries: 0 },
    effectiveRole: 'primary' as const,
    chain: [{ provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: { id: 'm' } }],
  }
  const ANSWER = { headline: 'אין לי מידע על פגישות.', claims: [], unknown: null }
  let offered: string[] = []
  let attempt: unknown = 'not-attempted'

  beforeEach(() => {
    offered = []
    attempt = 'not-attempted'
    admitAiRun.mockReset().mockResolvedValue(ADMITTED)
    buildTodayBrief.mockReset()
    // A model that TRIES list_meetings whatever it was told: it can only run what it was given.
    generateTextSpy.mockReset().mockImplementation(async (args: { tools: Record<string, { execute?: (i: unknown, o: unknown) => Promise<unknown> }> }) => {
      offered = Object.keys(args.tools)
      attempt = args.tools.list_meetings?.execute ? await args.tools.list_meetings.execute({ period: 'today' }, OPTS) : undefined
      return { output: ANSWER, totalUsage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop', steps: [], text: '', toolCalls: [], toolResults: [] }
    })
  })

  it('disabled: the model is not offered the tool or its rule, and no meeting is read', async () => {
    resolveAgentScope.mockReset().mockResolvedValue(scopeOf(ALLOWED))
    await runAgentInvestigation({ question: 'מה יש לי היום?' })
    expect(offered).not.toContain('list_meetings')
    expect(attempt).toBeUndefined()
    expect(listOrganizerMeetings).not.toHaveBeenCalled()
    expect((generateTextSpy.mock.calls[0]![0] as { system: string }).system).not.toContain('list_meetings')
  })

  it('enabled for this agency: offered, with its rule, and it reads this agency only', async () => {
    process.env[ENV] = String(ALLOWED)
    resolveAgentScope.mockReset().mockResolvedValue(scopeOf(ALLOWED))
    await runAgentInvestigation({ question: 'מה יש לי היום?' })
    expect(offered).toContain('list_meetings')
    expect((generateTextSpy.mock.calls[0]![0] as { system: string }).system).toContain(LIST_MEETINGS_RULE)
    expect(listOrganizerMeetings).toHaveBeenCalledWith(expect.objectContaining({ agencyId: ALLOWED }))
  })

  it('enabled for another agency only: this agency gets neither tool nor rule', async () => {
    process.env[ENV] = String(OTHER)
    resolveAgentScope.mockReset().mockResolvedValue(scopeOf(ALLOWED))
    await runAgentInvestigation({ question: 'מה יש לי היום?' })
    expect(offered).not.toContain('list_meetings')
    expect(listOrganizerMeetings).not.toHaveBeenCalled()
    expect((generateTextSpy.mock.calls[0]![0] as { system: string }).system).not.toContain('list_meetings')
  })
})
