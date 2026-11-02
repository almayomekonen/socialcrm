/**
 * B5 — the Agent investigation loop.
 *
 * The loop is where SocialCRM's guarantees meet the SDK's, so these tests pin the
 * seam rather than the happy path: admission decides whether a model is called at
 * all, the Budget (not `stopWhen`) is the authority on how far an investigation
 * may go, evidence can only come from tools, and an answer that cannot be
 * supported is refused rather than repaired.
 *
 * `stepCountIs(n)` is `steps.length === n` — a strict equality, not `>=`. That is
 * exactly why the Budget is consulted inside every tool: if the SDK's own stop
 * condition is ever missed, the tools still cannot run past the ceiling.
 *
 * Runs under VITEST_NO_DB=1 — every reader and the model call are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAgentScope = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
const generateTextSpy = vi.hoisted(() => vi.fn())
const addDailySpend = vi.hoisted(() => vi.fn())
const agentTrace = vi.hoisted(() => vi.fn())
const buildTodayBrief = vi.hoisted(() => vi.fn())
const getNamedLeadById = vi.hoisted(() => vi.fn())
const getLeadIntelligenceInputs = vi.hoisted(() => vi.fn())
const findLatestLeadConversation = vi.hoisted(() => vi.fn())
const listAgentConversationMessages = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope }))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend, getDailySpend: () => 0 }))
vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation,
  listAgentConversationMessages,
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))
// Only the model call is replaced — `tool`, `Output` and `stepCountIs` stay real,
// so the tools under test are the ones the SDK would actually receive.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextSpy }
})

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runAgentInvestigation } from '@/lib/agent/run'
import { buildAgentSystemPrompt } from '@/lib/agent/prompt'
import { WA_AGENT_RULES } from '@/lib/waAssistant/agentRules'
import { DEFAULT_MAX_STEPS } from '@/lib/agent/budget'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }

const MODEL_A = { id: 'model-a' }
const MODEL_B = { id: 'model-b' }
const CFG = { role: 'primary', maxOutputTokens: 1_200, timeoutMs: 40_000, retryOnSameProvider: 0, providerMaxRetries: 0 }
const ADMITTED = {
  ok: true as const,
  cfg: CFG,
  effectiveRole: 'primary' as const,
  chain: [
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: MODEL_A },
    { provider: 'openai', modelId: 'gpt-5.6', model: MODEL_B },
  ],
}

const BRIEF = {
  greeting: 'בוקר טוב',
  firstName: 'עלמה',
  items: [{ id: 42, name: 'דוד', state: 'waiting_reply', reason: 'ממתין לתשובה', targetSurface: 'inbox', phone: '050' }],
  total: 1,
  remaining: 1,
  handledToday: 0,
  volumeState: 'normal',
  statusVerdict: 'ok',
  meetings: [],
}

/** A well-formed answer citing evidence the Today tool really produced. */
const GOOD_ANSWER = {
  headline: 'ליד אחד ממתין לתשובה.',
  claims: [{ claimClass: 'FACT' as const, text: 'דוד ממתין לתשובה.', entityEvidence: ['42'] }],
  unknown: null,
}

const OPTS = { toolCallId: 't1', messages: [] } as never

/** Default model behaviour: call the Today tool once, then answer. */
function modelCallsTodayThenAnswers(answer: unknown = GOOD_ANSWER, usage = { inputTokens: 100, outputTokens: 50 }) {
  return async (args: { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> }) => {
    await args.tools.get_today_state.execute({}, OPTS)
    return { output: answer, totalUsage: usage, finishReason: 'stop', steps: [], text: '', toolCalls: [], toolResults: [] }
  }
}

const lastCall = () => generateTextSpy.mock.calls[0]![0] as Record<string, never>

beforeEach(() => {
  resolveAgentScope.mockReset().mockResolvedValue(SCOPE)
  admitAiRun.mockReset().mockResolvedValue(ADMITTED)
  addDailySpend.mockReset()
  agentTrace.mockReset()
  buildTodayBrief.mockReset().mockResolvedValue(BRIEF)
  getNamedLeadById.mockReset().mockResolvedValue(null)
  getLeadIntelligenceInputs.mockReset().mockResolvedValue(null)
  findLatestLeadConversation.mockReset().mockResolvedValue(null)
  listAgentConversationMessages.mockReset().mockResolvedValue([])
  generateTextSpy.mockReset().mockImplementation(modelCallsTodayThenAnswers())
})

// ── Admission ─────────────────────────────────────────────────────────────────

describe('B8 · autonomous spend is isolated from interactive spend', () => {
  it('an interactive run charges the shared in-memory counter', async () => {
    addDailySpend.mockClear()
    await runAgentInvestigation({ question: 'q' })
    expect(addDailySpend).toHaveBeenCalled()
  })

  it('an autonomous run charges NOTHING to it — proactive work can never deny a rep', async () => {
    addDailySpend.mockClear()
    const res = await runAgentInvestigation({ question: 'q', skipInteractiveSpend: true })
    expect(addDailySpend).not.toHaveBeenCalled()
    // The cost is still computed and returned, for the durable ledger to settle.
    expect(typeof res.costUsd).toBe('number')
  })
})

describe('admission decides whether a model is called at all', () => {
  it.each([
    'disabled',
    'forbidden',
    'no-providers',
    'over-quota',
    'subscription-required',
    'trial-not-started',
    'all-providers-failed',
    'invalid-input',
  ])('a %s denial returns gate_denied and never calls the model', async (reason) => {
    admitAiRun.mockResolvedValue({ ok: false, reason })
    const res = await runAgentInvestigation({ question: 'מה דורש טיפול?' })

    expect(res).toEqual({
      ok: false,
      reason: 'gate_denied',
      message: reason,
      investigationId: expect.stringMatching(/^inv_/),
      // Phase 4.3 exposes the real cost so an autonomous run can settle its
      // durable hold. A denial spends nothing, and says so explicitly rather
      // than omitting the field.
      costUsd: 0,
    })
    expect(generateTextSpy).not.toHaveBeenCalled()
    expect(addDailySpend).not.toHaveBeenCalled()
    expect(buildTodayBrief).not.toHaveBeenCalled()
  })

  it('admits with the agency from the session scope, never from the caller', async () => {
    await runAgentInvestigation({ question: 'q' })
    expect(admitAiRun).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent.investigate', agencyId: 7 }))
  })

  it('resolves scope BEFORE admission — an unauthorized session never reaches the gate', async () => {
    resolveAgentScope.mockRejectedValue(new Error('no session'))
    await expect(runAgentInvestigation({ question: 'q' })).rejects.toThrow('no session')
    expect(admitAiRun).not.toHaveBeenCalled()
  })
})

// ── Model wiring ──────────────────────────────────────────────────────────────

describe('surfaceRules: one surface\'s rules never reach another', () => {
  const NOW = Date.UTC(2026, 10, 4, 8, 0)

  it('omitted (the web Agent): the system prompt is exactly the shared prompt', async () => {
    await runAgentInvestigation({ question: 'q', now: () => NOW })
    expect(lastCall().system).toBe(buildAgentSystemPrompt(NOW))
  })

  it('given: appended after the shared prompt, which is otherwise untouched', async () => {
    await runAgentInvestigation({ question: 'q', now: () => NOW, surfaceRules: 'כלל' })
    expect(lastCall().system).toBe(`${buildAgentSystemPrompt(NOW)}\n\nכלל`)
  })

  it('the shared prompt does not carry the WhatsApp rules', () => {
    expect(buildAgentSystemPrompt(NOW)).not.toContain(WA_AGENT_RULES)
    expect(buildAgentSystemPrompt(NOW)).not.toContain('וואטסאפ עם בעל העסק')
  })

  it('only the WhatsApp worker passes it: the web and autonomous paths never name it', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
      )
    const users = ['actions', 'app', 'components', 'lib'].flatMap(files).filter((f) => readFileSync(f, 'utf8').includes('surfaceRules'))
    expect(users.sort()).toEqual(['lib/agent/run.ts', 'lib/waAssistant/agentRules.ts', 'lib/waAssistant/worker.ts'])
  })
})

describe('the admitted model and config drive the call', () => {
  it('uses chain[0] only — B5 v1 is single-provider, no fallback', async () => {
    await runAgentInvestigation({ question: 'q' })
    expect(lastCall().model).toBe(MODEL_A)
    expect(generateTextSpy).toHaveBeenCalledTimes(1)
  })

  it('passes the admitted maxOutputTokens and providerMaxRetries', async () => {
    await runAgentInvestigation({ question: 'q' })
    expect(lastCall().maxOutputTokens).toBe(1_200)
    expect(lastCall().maxRetries).toBe(0)
  })

  it('sends the system prompt and the caller question', async () => {
    await runAgentInvestigation({ question: 'מה דורש טיפול?' })
    expect(String(lastCall().system)).toContain('SocialCRM')
    // `messages`, not `prompt`: the request carries the conversation so a
    // follow-up has a referent. With no history the array is a single user
    // message — exactly what `prompt` desugars to, so a first question is the
    // same request it always was.
    expect(lastCall().prompt).toBeUndefined()
    expect(lastCall().messages).toEqual([{ role: 'user', content: 'מה דורש טיפול?' }])
  })

  it('places prior turns before the new question, oldest first', async () => {
    await runAgentInvestigation({
      question: 'ומה עם יוסי?',
      history: [
        { role: 'user', content: 'מי צריך טיפול?' },
        { role: 'assistant', content: 'שלושה לידים ממתינים.' },
      ],
    })
    expect(lastCall().messages).toEqual([
      { role: 'user', content: 'מי צריך טיפול?' },
      { role: 'assistant', content: 'שלושה לידים ממתינים.' },
      { role: 'user', content: 'ומה עם יוסי?' },
    ])
  })

  it('bounds the loop with stopWhen at the step ceiling', async () => {
    await runAgentInvestigation({ question: 'q' })
    const stopWhen = lastCall().stopWhen as unknown as (a: { steps: unknown[] }) => boolean
    expect(typeof stopWhen).toBe('function')
    expect(stopWhen({ steps: Array(DEFAULT_MAX_STEPS - 1).fill(0) })).toBe(false)
    expect(stopWhen({ steps: Array(DEFAULT_MAX_STEPS).fill(0) })).toBe(true)
  })

  it('requests structured output', async () => {
    await runAgentInvestigation({ question: 'q' })
    expect(lastCall().output).toBeDefined()
  })

  it('forwards caller cancellation to the model call', async () => {
    // The model now receives a COMBINED signal — the caller's cancellation
    // chained with the run's own wall-clock deadline — so identity is no longer
    // the contract. What matters is that aborting the caller aborts what the
    // provider is holding, which is what this asserts. The deadline half is
    // covered in wallClock.test.ts.
    const ac = new AbortController()
    await runAgentInvestigation({ question: 'q', abortSignal: ac.signal })
    const forwarded = lastCall().abortSignal as unknown as AbortSignal
    expect(forwarded).toBeInstanceOf(AbortSignal)
    // Deliberately NOT the caller's own object any more.
    expect(forwarded).not.toBe(ac.signal)
    expect(forwarded.aborted).toBe(false)

    // And the chain is released when the run ends: aborting afterwards must not
    // reach back into a finished investigation. Propagation WHILE in flight is
    // proven in wallClock.test.ts.
    ac.abort()
    expect(forwarded.aborted).toBe(false)
  })

  it('starts already-cancelled when the caller signal is', async () => {
    await runAgentInvestigation({ question: 'q', abortSignal: AbortSignal.abort() })
    expect((lastCall().abortSignal as unknown as AbortSignal).aborted).toBe(true)
  })
})

// ── Tools, scope and isolation ────────────────────────────────────────────────

describe('tools carry authority from the scope, never from the model', () => {
  it('hands the model exactly the ten read-only tools', async () => {
    await runAgentInvestigation({ question: 'q' })
    expect(Object.keys(lastCall().tools as object).sort()).toEqual([
      'find_lead',
      'get_activity_trends',
      'get_business_summary',
      'get_conversation',
      'get_follow_up_health',
      'get_lead',
      'get_lead_health',
      'get_lead_segment',
      'get_revenue',
      'get_today_state',
    ])
  })

  it('no tool input schema exposes a scope field the model could set', async () => {
    await runAgentInvestigation({ question: 'q' })
    const tools = lastCall().tools as unknown as Record<string, { inputSchema: { shape?: object } }>
    for (const t of Object.values(tools)) {
      const keys = Object.keys(t.inputSchema?.shape ?? {})
      for (const forbidden of ['agencyId', 'userId', 'role', 'plan', 'gotPermIds', 'permissions']) {
        expect(keys).not.toContain(forbidden)
      }
    }
  })

  it('the session scope reaches the business reader', async () => {
    await runAgentInvestigation({ question: 'q' })
    expect(buildTodayBrief).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 7, userId: 3 }), expect.any(Number))
  })

  it('a cross-agency lead is not found — the gate uses the scope agency', async () => {
    generateTextSpy.mockImplementation(async (args: never) => {
      const tools = (args as unknown as { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> })
        .tools
      const out = await tools.get_lead.execute({ leadId: 999 }, OPTS)
      return {
        output: GOOD_ANSWER,
        totalUsage: {},
        finishReason: 'stop',
        steps: [],
        text: '',
        toolCalls: [],
        toolResults: [],
        probe: out,
      }
    })
    await runAgentInvestigation({ question: 'q' })
    // The gate receives the session-derived permission scope plus the model's
    // leadId — and nothing else. The agency itself is resolved INSIDE
    // getNamedLeadById via getAgencyId(), so it is not merely absent from the
    // model's reach, it is absent from the tool's reach too.
    expect(getNamedLeadById).toHaveBeenCalledWith({ user: { role: Roles.ADMIN }, gotPermIds: [], agencyId: 7 }, 999)
    // Denied ⇒ nothing beneath the gate is ever touched.
    expect(getLeadIntelligenceInputs).not.toHaveBeenCalled()
  })
})

// ── Budget ────────────────────────────────────────────────────────────────────

describe('the Budget, not stopWhen, is the authority', () => {
  it('refuses tool calls past the ceiling even if the loop keeps going', async () => {
    const results: unknown[] = []
    generateTextSpy.mockImplementation(async (args: never) => {
      const tools = (args as unknown as { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> })
        .tools
      for (let i = 0; i < DEFAULT_MAX_STEPS + 3; i++) {
        results.push(await tools.get_lead.execute({ leadId: 100 + i }, OPTS))
      }
      return { output: GOOD_ANSWER, totalUsage: {}, finishReason: 'stop', steps: [], text: '', toolCalls: [], toolResults: [] }
    })
    await runAgentInvestigation({ question: 'q' })

    const refused = results.filter((r) => (r as { refused?: boolean }).refused === true)
    expect(refused.length).toBe(3)
    expect((refused[0] as { reason: string }).reason).toBe('step_ceiling')
  })

  it('reports the budget stop reason on an answer produced after the ceiling', async () => {
    generateTextSpy.mockImplementation(async (args: never) => {
      const tools = (args as unknown as { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> })
        .tools
      await tools.get_today_state.execute({}, OPTS)
      for (let i = 0; i < DEFAULT_MAX_STEPS + 1; i++) await tools.get_lead.execute({ leadId: 200 + i }, OPTS)
      return { output: GOOD_ANSWER, totalUsage: {}, finishReason: 'stop', steps: [], text: '', toolCalls: [], toolResults: [] }
    })
    const res = await runAgentInvestigation({ question: 'q' })
    expect(res.ok).toBe(true)
    if (res.ok !== true) throw new Error('unreachable')
    expect(res.stopReason).toBe('step_ceiling')
    expect(res.steps).toBe(DEFAULT_MAX_STEPS)
  })

  it('honours a caller-supplied smaller ceiling', async () => {
    await runAgentInvestigation({ question: 'q', maxSteps: 2 })
    const stopWhen = lastCall().stopWhen as unknown as (a: { steps: unknown[] }) => boolean
    expect(stopWhen({ steps: [0, 0] })).toBe(true)
  })

  it('a clean answer within budget stops as answered', async () => {
    const res = await runAgentInvestigation({ question: 'q' })
    if (res.ok !== true) throw new Error('unreachable')
    expect(res.stopReason).toBe('answered')
    expect(res.steps).toBe(1)
  })
})

// ── Evidence and validation ───────────────────────────────────────────────────

describe('evidence comes only from tools, and unsupported claims are refused', () => {
  it('returns the evidence the tools collected', async () => {
    const res = await runAgentInvestigation({ question: 'q' })
    if (res.ok !== true) throw new Error('unreachable')
    expect(res.evidence).toEqual(expect.arrayContaining([{ kind: 'lead', refId: '42' }]))
    expect(res.evidence.some((e) => e.kind === 'metric' && e.metric === 'today.total')).toBe(true)
  })

  it('drops a claim citing evidence no tool produced', async () => {
    generateTextSpy.mockImplementation(
      modelCallsTodayThenAnswers({
        headline: 'סיכום',
        claims: [
          { claimClass: 'FACT', text: 'דוד ממתין.', entityEvidence: ['42'] },
          { claimClass: 'FACT', text: 'רותי ממתינה.', entityEvidence: ['9999'] },
        ],
        unknown: null,
      }),
    )
    const res = await runAgentInvestigation({ question: 'q' })
    if (res.ok !== true) throw new Error('unreachable')
    expect(res.answer.claims).toHaveLength(1)
    expect(res.answer.claims[0]!.text).toBe('דוד ממתין.')
  })

  it('refuses the whole answer when nothing is supportable', async () => {
    generateTextSpy.mockImplementation(
      modelCallsTodayThenAnswers({
        headline: 'סיכום',
        claims: [{ claimClass: 'FACT', text: 'המצאה.', entityEvidence: ['9999'] }],
        unknown: null,
      }),
    )
    expect(await runAgentInvestigation({ question: 'q' })).toMatchObject({ ok: false, reason: 'no_evidence' })
  })

  it('refuses an answer carrying an unsupported business claim', async () => {
    generateTextSpy.mockImplementation(
      modelCallsTodayThenAnswers({
        headline: 'ליד חם מאוד, סיכוי גבוה לסגירה',
        claims: [{ claimClass: 'FACT', text: 'דוד ממתין.', entityEvidence: ['42'] }],
        unknown: null,
      }),
    )
    expect(await runAgentInvestigation({ question: 'q' })).toMatchObject({ ok: false, reason: 'no_evidence' })
  })

  it('refuses a malformed payload rather than repairing it', async () => {
    generateTextSpy.mockImplementation(modelCallsTodayThenAnswers({ headline: '', claims: [], unknown: null }))
    expect(await runAgentInvestigation({ question: 'q' })).toMatchObject({ ok: false, reason: 'no_evidence' })
  })
})

// ── Spend, failures, trace ────────────────────────────────────────────────────

describe('spend accounting', () => {
  it('charges the agency for the whole investigation, from totalUsage', async () => {
    await runAgentInvestigation({ question: 'q' })
    expect(addDailySpend).toHaveBeenCalledTimes(1)
    expect(addDailySpend.mock.calls[0]![0]).toBe(7)
    expect(addDailySpend.mock.calls[0]![1]).toBeGreaterThan(0)
  })

  it('still charges when the answer is refused — the tokens were spent', async () => {
    generateTextSpy.mockImplementation(
      modelCallsTodayThenAnswers({
        headline: 'x',
        claims: [{ claimClass: 'FACT', text: 'x', entityEvidence: ['9999'] }],
        unknown: null,
      }),
    )
    expect(await runAgentInvestigation({ question: 'q' })).toMatchObject({ ok: false })
    expect(addDailySpend).toHaveBeenCalledTimes(1)
  })

  it('treats missing usage as zero rather than throwing', async () => {
    generateTextSpy.mockImplementation(modelCallsTodayThenAnswers(GOOD_ANSWER, {} as never))
    expect(await runAgentInvestigation({ question: 'q' })).toMatchObject({ ok: true })
  })
})

describe('failures', () => {
  it('a provider failure is an honest error, not a repaired answer', async () => {
    generateTextSpy.mockRejectedValue(new Error('anthropic 529 overloaded'))
    const res = await runAgentInvestigation({ question: 'q' })
    expect(res).toMatchObject({ ok: false, reason: 'error' })
    expect((res as { message?: string }).message).toContain('overloaded')
    expect(addDailySpend).not.toHaveBeenCalled()
  })

  it('does NOT fall back to the second provider', async () => {
    generateTextSpy.mockRejectedValue(new Error('boom'))
    await runAgentInvestigation({ question: 'q' })
    expect(generateTextSpy).toHaveBeenCalledTimes(1)
  })

  it('an abort surfaces as a failure', async () => {
    generateTextSpy.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    expect(await runAgentInvestigation({ question: 'q' })).toMatchObject({ ok: false, reason: 'error' })
  })
})

describe('trace completeness', () => {
  it('records start, admission, generation and outcome', async () => {
    await runAgentInvestigation({ question: 'q' })
    const stages = agentTrace.mock.calls.map((c) => c[0])
    expect(stages).toContain('INVESTIGATION_START')
    expect(stages).toContain('ADMISSION_OK')
    expect(stages).toContain('GENERATION_COMPLETE')
    expect(stages).toContain('INVESTIGATION_END')
  })

  it('records the denial instead of the generation when admission fails', async () => {
    admitAiRun.mockResolvedValue({ ok: false, reason: 'over-quota' })
    await runAgentInvestigation({ question: 'q' })
    const stages = agentTrace.mock.calls.map((c) => c[0])
    expect(stages).toContain('ADMISSION_DENIED')
    expect(stages).not.toContain('GENERATION_COMPLETE')
  })

  it('carries the investigation identity on every record', async () => {
    await runAgentInvestigation({ question: 'q' })
    for (const call of agentTrace.mock.calls) {
      expect(call[1]).toMatchObject({ agencyId: 7, userId: 3 })
      expect(String((call[1] as { investigationId?: string }).investigationId ?? '')).not.toBe('')
    }
  })

  it('never traces the question or any claim text', async () => {
    await runAgentInvestigation({ question: 'SECRET-QUESTION-TEXT' })
    const dump = JSON.stringify(agentTrace.mock.calls)
    expect(dump).not.toContain('SECRET-QUESTION-TEXT')
    expect(dump).not.toContain('דוד ממתין לתשובה.')
  })
})

// ── F4 · the research clock ends inside the route limit ───────────────────────

describe('F4 · a research run ends at its own deadline, before the platform would', () => {
  it('a model that never answers is cancelled at RESEARCH_DEADLINE_MS and reported as a deadline', async () => {
    const { RESEARCH_DEADLINE_MS } = await import('@/lib/agent/research/admission')
    const { ROUTE_MAX_DURATION_MS } = await import('@/lib/agent/budget')
    vi.useFakeTimers()
    try {
      // A provider that hangs until it is cancelled — as a slow hosted search does.
      generateTextSpy.mockImplementation(
        (args: { abortSignal: AbortSignal }) =>
          new Promise((_, reject) => args.abortSignal.addEventListener('abort', () => reject(args.abortSignal.reason))),
      )
      let settled: unknown = undefined
      // "מתחרים" is a research marker, so this run gets the research deadline.
      const run = runAgentInvestigation({ question: 'מה המתחרים שלי עושים בשוק?' }).then((r) => (settled = r))

      await vi.advanceTimersByTimeAsync(RESEARCH_DEADLINE_MS - 1)
      expect(settled).toBeUndefined()

      await vi.advanceTimersByTimeAsync(1)
      await run
      expect(settled).toMatchObject({ ok: false, reason: 'deadline', message: 'deadline' })
      // …and that happened strictly before the function would have been killed.
      expect(RESEARCH_DEADLINE_MS).toBeLessThan(ROUTE_MAX_DURATION_MS)
    } finally {
      vi.useRealTimers()
    }
  })
})
