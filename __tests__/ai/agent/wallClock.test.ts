/**
 * The wall-clock deadline — the ceiling the Budget cannot enforce.
 *
 * `Budget.canStep` runs inside a tool's execute, so it bounds an investigation
 * that is CALLING TOOLS and not one that is waiting on the provider. A live run
 * found the hole: a question stalled for 487 seconds having made zero tool calls,
 * so the 40s deadline was never consulted once.
 *
 * These pin that the signal reaches the model call itself — cancelling the
 * request rather than abandoning it — that the ceiling is absolute across a
 * two-phase run, and that a timeout is reported as its own outcome without ever
 * producing an answer.
 *
 * Deterministic throughout: fake timers, mocked model. Nothing here waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAgentScope = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
const generateTextSpy = vi.hoisted(() => vi.fn())
const addDailySpend = vi.hoisted(() => vi.fn())
const agentTrace = vi.hoisted(() => vi.fn())
const buildTodayBrief = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope }))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend, getDailySpend: () => 0 }))
vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
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

import { runAgentInvestigation } from '@/lib/agent/run'
import { DEFAULT_DEADLINE_MS } from '@/lib/agent/budget'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }
const CFG = { role: 'primary', maxOutputTokens: 1_200, timeoutMs: 40_000, retryOnSameProvider: 0, providerMaxRetries: 0 }
const ADMITTED = {
  ok: true as const,
  cfg: CFG,
  effectiveRole: 'primary' as const,
  chain: [{ provider: 'openai', modelId: 'gpt-5.6', model: { id: 'm' } }],
}

const BRIEF = {
  greeting: 'בוקר טוב',
  firstName: 'עלמה',
  items: [{ id: 42, name: 'דוד', state: 'waiting_reply', reason: 'ממתין', targetSurface: 'inbox', phone: '050' }],
  total: 1,
  remaining: 1,
  handledToday: 0,
  volumeState: 'normal',
  statusVerdict: 'ok',
  meetings: [],
}

const GOOD_ANSWER = {
  headline: 'ליד אחד ממתין לתשובה.',
  claims: [{ claimClass: 'FACT' as const, text: 'דוד ממתין לתשובה.', entityEvidence: ['42'] }],
  unknown: null,
}

const OPTS = { toolCallId: 't1', messages: [] } as never

/** A model that never settles until its signal aborts — the 487s stall, in miniature. */
function stallingModel() {
  return (args: { abortSignal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = args.abortSignal
      if (!signal) return // no signal wired: the promise hangs and the test times out, which is the point
      if (signal.aborted) return reject(new Error('aborted'))
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  resolveAgentScope.mockResolvedValue(SCOPE)
  admitAiRun.mockResolvedValue(ADMITTED)
  buildTodayBrief.mockResolvedValue(BRIEF)
  generateTextSpy.mockImplementation(async (args: { tools?: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> }) => {
    if (args.tools) await args.tools.get_today_state!.execute({}, OPTS)
    return { output: GOOD_ANSWER, totalUsage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'stop', steps: [] }
  })
})

afterEach(() => vi.useRealTimers())

const lastCall = () => generateTextSpy.mock.calls[0]![0] as Record<string, never>

// ─── The signal reaches the model ───────────────────────────────────────────

describe('the deadline reaches the model call itself', () => {
  it('passes an AbortSignal into generateText', async () => {
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    const signal = lastCall().abortSignal as unknown as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('does not fire immediately — a units or epoch slip would abort at step zero', async () => {
    // The bug class this guards: seconds-vs-milliseconds, or a deadline computed
    // from the wrong epoch, would make every investigation time out instantly.
    const r = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(r.ok).toBe(true)
    expect((lastCall().abortSignal as unknown as AbortSignal).aborted).toBe(false)
  })

  it('a normal call still succeeds and is unaffected', async () => {
    const r = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(r.ok).toBe(true)
    if (r.ok !== true) throw new Error('unreachable')
    expect(r.answer.headline).toBe(GOOD_ANSWER.headline)
    expect(r.stopReason).toBe('answered')
  })
})

// ─── The stall is actually cancelled ────────────────────────────────────────

describe('a stalled provider call is aborted at the deadline', () => {
  it('aborts the in-flight request rather than abandoning it', async () => {
    let observed: AbortSignal | undefined
    generateTextSpy.mockImplementation((args: { abortSignal?: AbortSignal }) => {
      observed = args.abortSignal
      return stallingModel()(args)
    })

    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE })
    // Let admission and scope resolution settle so the model call has actually
    // been made — asserting before that reads an undefined signal.
    await vi.advanceTimersByTimeAsync(0)
    expect(observed, 'the model call must have received a signal').toBeDefined()
    expect(observed!.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_MS + 10)
    const r = await pending

    // The signal the PROVIDER received is aborted — this is the difference
    // between cancelling the request and walking away from it.
    expect(observed!.aborted).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('returns a controlled deadline result, distinct from an ordinary error', async () => {
    generateTextSpy.mockImplementation(stallingModel())
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE })
    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_MS + 10)
    const r = await pending

    expect(r.ok).toBe(false)
    if (r.ok !== false) throw new Error('unreachable')
    expect(r.reason).toBe('deadline')
    expect(r.investigationId).toBeTruthy()
  })

  it('emits NO answer after a timeout', async () => {
    generateTextSpy.mockImplementation(stallingModel())
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE })
    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_MS + 10)
    const r = await pending
    expect(r.ok).toBe(false)
    expect(r).not.toHaveProperty('answer')
  })

  it('leaks no provider text to the client', async () => {
    generateTextSpy.mockImplementation(() => {
      throw Object.assign(new Error('openai: model gpt-5.6 upstream socket closed'), { name: 'APICallError' })
    })
    // A genuine provider error still reports as an error, with its own message.
    const err = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(err.ok).toBe(false)
    if (err.ok !== false) throw new Error('unreachable')
    expect(err.reason).toBe('error')

    // A timeout reports a stable token instead.
    generateTextSpy.mockImplementation(stallingModel())
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE })
    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_MS + 10)
    const out = await pending
    if (out.ok !== false) throw new Error('unreachable')
    expect(out.message).toBe('deadline')
    expect(out.message).not.toMatch(/gpt|openai|socket|abort/i)
  })

  it('honours a shorter caller-supplied deadline', async () => {
    generateTextSpy.mockImplementation(stallingModel())
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE, deadlineMs: 5_000 })
    await vi.advanceTimersByTimeAsync(4_000)
    await vi.advanceTimersByTimeAsync(1_500)
    const r = await pending
    if (r.ok !== false) throw new Error('unreachable')
    expect(r.reason).toBe('deadline')
  })
})

// ─── The caller's own cancellation still works, and is a different outcome ──

describe('caller cancellation is chained, not replaced', () => {
  it('a caller abort cancels the model call', async () => {
    let observed: AbortSignal | undefined
    generateTextSpy.mockImplementation((args: { abortSignal?: AbortSignal }) => {
      observed = args.abortSignal
      return stallingModel()(args)
    })
    const ac = new AbortController()
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE, abortSignal: ac.signal })
    await vi.advanceTimersByTimeAsync(0)
    ac.abort()
    const r = await pending
    expect(observed!.aborted).toBe(true)
    expect(r.ok).toBe(false)
    if (r.ok !== false) throw new Error('unreachable')
    // Not a deadline: the rep walked away, the clock did not run out.
    expect(r.reason).toBe('error')
  })

  it('an already-aborted caller signal never starts a long wait', async () => {
    generateTextSpy.mockImplementation(stallingModel())
    const r = await runAgentInvestigation({ question: 'q', scope: SCOPE, abortSignal: AbortSignal.abort() })
    expect(r.ok).toBe(false)
  })
})

// ─── Trace and durable records stay correct ─────────────────────────────────

describe('a timeout run leaves honest records', () => {
  it('traces the timeout distinctly and closes the investigation', async () => {
    generateTextSpy.mockImplementation(stallingModel())
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE })
    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_MS + 10)
    await pending

    const stages = agentTrace.mock.calls.map((c) => c[0])
    expect(stages).toContain('GENERATION_FAILED')
    expect(stages).toContain('INVESTIGATION_END')

    const failed = agentTrace.mock.calls.find((c) => c[0] === 'GENERATION_FAILED')!
    expect(failed[2]).toMatchObject({ timedOut: true })
    const end = agentTrace.mock.calls.find((c) => c[0] === 'INVESTIGATION_END')!
    expect(end[2]).toMatchObject({ ok: false, reason: 'deadline' })
  })

  it('persists the run as failed with the deadline reason and no provider text', async () => {
    generateTextSpy.mockImplementation(stallingModel())
    const onPersist = vi.fn()
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE, onPersist })
    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_MS + 10)
    await pending

    expect(onPersist).toHaveBeenCalledTimes(1)
    expect(onPersist.mock.calls[0]![0]).toMatchObject({
      status: 'failed',
      stopReason: 'deadline',
      answer: null,
      failureReason: 'wall-clock-deadline',
    })
  })

  it('charges nothing for a run that produced no usage', async () => {
    generateTextSpy.mockImplementation(stallingModel())
    const pending = runAgentInvestigation({ question: 'q', scope: SCOPE })
    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_MS + 10)
    const r = await pending
    expect(r.costUsd).toBe(0)
    expect(addDailySpend).not.toHaveBeenCalled()
  })
})

// ─── The step budget is untouched ───────────────────────────────────────────

describe('the wall clock is an ADDITIONAL boundary, not a replacement', () => {
  it('the tool-step budget still stops a runaway loop', async () => {
    let calls = 0
    generateTextSpy.mockImplementation(async (args: { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }> }) => {
      // Ask for the same tool far more often than the ceiling allows.
      for (let i = 0; i < 20; i++) {
        const out = await args.tools.get_today_state!.execute({}, OPTS)
        if (out.refused) break
        calls++
      }
      return { output: GOOD_ANSWER, totalUsage: {}, finishReason: 'stop', steps: [] }
    })
    const r = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(r.ok).toBe(true)
    // The repeat rule refuses the second identical call, so the ceiling is never
    // even approached — the budget is doing its job independently of the clock.
    expect(calls).toBe(1)
  })

  it('evidence validation still refuses an ungrounded answer', async () => {
    generateTextSpy.mockImplementation(async (args: { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> }) => {
      await args.tools.get_today_state!.execute({}, OPTS)
      return {
        output: { headline: 'x', claims: [{ claimClass: 'FACT', text: 'לא קיים', entityEvidence: ['99999'] }], unknown: null },
        totalUsage: {},
        finishReason: 'stop',
        steps: [],
      }
    })
    const r = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(r.ok).toBe(false)
    if (r.ok !== false) throw new Error('unreachable')
    expect(r.reason).toBe('no_evidence')
  })
})
