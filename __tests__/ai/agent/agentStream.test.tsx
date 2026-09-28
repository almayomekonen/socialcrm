// @vitest-environment jsdom
/**
 * The wire between the agent surface and the streaming route.
 *
 * These cover the parts that only break in the browser: SSE frames arriving
 * split across chunks, progress reaching the thinking row, a refusal becoming a
 * sentence a rep can act on, and follow-up questions carrying their context.
 *
 * `fetch` is the only thing mocked — the hook's own parsing, state machine and
 * history construction all run for real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAgentConversation } from '@/components/agent/useAgentConversation'
import { failureMessage, toolLabel } from '@/components/agent/agentTypes'

const ANSWER = {
  ok: true,
  answer: {
    headline: 'שלושה לידים ממתינים למענה.',
    claims: [
      { claimClass: 'FACT', text: 'דוד כהן ממתין 47 דקות.', entityEvidence: ['1'] },
      { claimClass: 'RECOMMENDATION', text: 'כדאי להתחיל בדוד.', evidence: ['1'] },
    ],
    unknown: null,
  },
  evidence: [],
  steps: 2,
  stopReason: 'answered',
  investigationId: 'inv_test_1',
  costUsd: 0.01,
}

/** Build a Response whose body yields the given chunks, in order. */
function sseResponse(chunks: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return { ok, status, body, json: async () => ({}) } as unknown as Response
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn(async (url: unknown, init: unknown) => impl(String(url), init as RequestInit))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('streaming reaches the UI', () => {
  it('renders the validated answer from the answer frame', async () => {
    mockFetch(() => sseResponse([frame('progress', { tool: 'get_today_state', step: 1 }), frame('answer', ANSWER)]))
    const { result } = renderHook(() => useAgentConversation())

    act(() => result.current.ask('מה דורש ממני טיפול היום?'))

    await waitFor(() => {
      const last = result.current.turns.at(-1)!
      expect(last.role === 'agent' && last.status).toBe('done')
    })
    const last = result.current.turns.at(-1)!
    if (last.role !== 'agent' || last.status !== 'done') throw new Error('expected a settled answer')
    expect(last.answer.headline).toBe('שלושה לידים ממתינים למענה.')
    expect(last.answer.claims).toHaveLength(2)
    expect(last.investigationId).toBe('inv_test_1')
    // The question is kept as its own turn, ahead of the answer.
    expect(result.current.turns[0]).toMatchObject({ role: 'user', text: 'מה דורש ממני טיפול היום?' })
  })

  it('parses frames split across chunk boundaries', async () => {
    // The failure this guards: a hand-rolled SSE client that assumes one frame
    // per chunk silently drops events under real network conditions.
    const whole = frame('progress', { tool: 'find_lead', step: 1 }) + frame('answer', ANSWER)
    const cut = Math.floor(whole.length / 2)
    mockFetch(() => sseResponse([whole.slice(0, cut), whole.slice(cut)]))

    const { result } = renderHook(() => useAgentConversation())
    act(() => result.current.ask('מי זה יוסי?'))

    await waitFor(() => {
      const last = result.current.turns.at(-1)!
      expect(last.role === 'agent' && last.status).toBe('done')
    })
  })

  it('shows the running capability while it works', async () => {
    let release: (r: Response) => void = () => {}
    const pending = new Promise<Response>((r) => (release = r))
    vi.stubGlobal('fetch', vi.fn(() => pending))

    const { result } = renderHook(() => useAgentConversation())
    act(() => result.current.ask('מה קורה בעסק?'))

    await waitFor(() => expect(result.current.busy).toBe(true))
    const thinking = result.current.turns.at(-1)!
    expect(thinking.role === 'agent' && thinking.status).toBe('thinking')

    await act(async () => {
      release(sseResponse([frame('progress', { tool: 'get_business_summary', step: 1 }), frame('answer', ANSWER)]))
      await pending
    })
    await waitFor(() => expect(result.current.busy).toBe(false))
  })

  it('labels tools in the rep\'s language, never by identifier', () => {
    expect(toolLabel('get_conversation')).toBe('קורא את השיחה')
    // An unmapped tool must not leak its symbol into the UI.
    expect(toolLabel('some_future_tool')).not.toContain('_')
  })
})

describe('failures become sentences a rep can act on', () => {
  it('maps a refusal to its own message, not a generic error', async () => {
    mockFetch(() => sseResponse([frame('answer', { ok: false, reason: 'no_evidence', investigationId: 'inv_2' })]))
    const { result } = renderHook(() => useAgentConversation())
    act(() => result.current.ask('כמה לידים סגרתי אשתקד?'))

    await waitFor(() => {
      const last = result.current.turns.at(-1)!
      expect(last.role === 'agent' && last.status).toBe('error')
    })
    const last = result.current.turns.at(-1)!
    if (last.role !== 'agent' || last.status !== 'error') throw new Error('expected an error turn')
    expect(last.message).toBe(failureMessage('no_evidence'))
    // A refusal is the validator working, so it must not read as a crash.
    expect(last.message).not.toBe(failureMessage('error'))
  })

  it('reports a rollout gate distinctly from a failure', async () => {
    mockFetch(() => ({ ok: false, status: 404, body: null, json: async () => ({ error: 'agent-disabled' }) }) as unknown as Response)
    const { result } = renderHook(() => useAgentConversation())
    act(() => result.current.ask('שאלה'))

    await waitFor(() => {
      const last = result.current.turns.at(-1)!
      expect(last.role === 'agent' && last.status).toBe('error')
    })
    const last = result.current.turns.at(-1)!
    if (last.role !== 'agent' || last.status !== 'error') throw new Error('expected an error turn')
    expect(last.message).toContain('לא פעיל')
  })

  it('does not leave a thinking row spinning when the stream ends with no outcome', async () => {
    mockFetch(() => sseResponse([frame('progress', { tool: 'get_today_state', step: 1 })]))
    const { result } = renderHook(() => useAgentConversation())
    act(() => result.current.ask('שאלה'))

    await waitFor(() => {
      const last = result.current.turns.at(-1)!
      expect(last.role === 'agent' && last.status).toBe('error')
    })
  })
})

describe('conversation context', () => {
  it('sends prior turns with a follow-up, oldest first', async () => {
    const spy = mockFetch(() => sseResponse([frame('answer', ANSWER)]))
    const { result } = renderHook(() => useAgentConversation())

    act(() => result.current.ask('מי צריך טיפול?'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    act(() => result.current.ask('ומה דחוף?'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    const second = JSON.parse(String((spy.mock.calls[1]![1] as RequestInit).body))
    expect(second.question).toBe('ומה דחוף?')
    expect(second.history).toEqual([
      { role: 'user', content: 'מי צריך טיפול?' },
      // The HEADLINE only: claims carry evidence refs that mean nothing outside
      // the run that produced them, and replaying them would dress last turn's
      // evidence up as this turn's.
      { role: 'assistant', content: ANSWER.answer.headline },
    ])
  })

  it('sends no history on the first question', async () => {
    const spy = mockFetch(() => sseResponse([frame('answer', ANSWER)]))
    const { result } = renderHook(() => useAgentConversation())
    act(() => result.current.ask('שאלה ראשונה'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body)).history).toEqual([])
  })

  it('omits unsettled turns from the context', async () => {
    const spy = mockFetch(() => sseResponse([frame('answer', { ok: false, reason: 'error' })]))
    const { result } = renderHook(() => useAgentConversation())

    act(() => result.current.ask('שאלה שנכשלה'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    act(() => result.current.ask('שאלה שנייה'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    const second = JSON.parse(String((spy.mock.calls[1]![1] as RequestInit).body))
    // The question stays — the rep did ask it. The failed answer asserted
    // nothing, so it contributes no assistant turn.
    expect(second.history).toEqual([{ role: 'user', content: 'שאלה שנכשלה' }])
  })

  it('reset clears the thread so the next question starts fresh', async () => {
    const spy = mockFetch(() => sseResponse([frame('answer', ANSWER)]))
    const { result } = renderHook(() => useAgentConversation())

    act(() => result.current.ask('ראשונה'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    act(() => result.current.reset())
    expect(result.current.turns).toEqual([])

    act(() => result.current.ask('אחרי איפוס'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(JSON.parse(String((spy.mock.calls[1]![1] as RequestInit).body)).history).toEqual([])
  })
})
