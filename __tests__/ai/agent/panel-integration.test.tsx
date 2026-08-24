// @vitest-environment jsdom

/**
 * B8 — GeneralModePanel ↔ POST /api/ai/agent.
 *
 * The panel is a shipped surface, so the first thing these tests pin is that the
 * Agent is OFF by default: with no `agentEnabled` prop the panel must behave
 * exactly as it does today, calling the existing General Mode action and never
 * touching the network.
 *
 * The second is the request itself. The route already refuses to forward
 * anything but the question, but a client that SENDS more is still a defect
 * waiting for a future route change to become a hole — so the body is asserted
 * to be exactly `{ question }`, and `investigationId` is asserted never to
 * travel back out on a follow-up.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('@/lib/copilot/useCopilot', () => ({ useCopilot: () => ({ closePanel: vi.fn() }) }))
vi.mock('@/actions/analytics/recordGeneralModeEvent', () => ({ recordGeneralModeEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/actions/ai/getDailyBriefing', () => ({ getDailyBriefing: vi.fn() }))
vi.mock('@/actions/ai/askGeneralQuestion', () => ({ askGeneralQuestion: vi.fn(), getLeadCardById: vi.fn() }))
vi.mock('@/components/copilot/ActiveGenerationRow', () => ({ default: () => <div data-testid='loader' /> }))
vi.mock('@/components/copilot/general/BriefingCards', () => ({ default: () => null }))
vi.mock('@/components/copilot/general/DeepLink', () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import GeneralModePanel from '@/components/copilot/general/GeneralModePanel'
import { getDailyBriefing } from '@/actions/ai/getDailyBriefing'
import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'

const BRIEFING = { kind: 'briefing', greeting: 'בוקר טוב', sections: [] }

const OK_RESULT = {
  ok: true,
  answer: {
    headline: 'שני לידים ממתינים לתשובה.',
    claims: [
      { claimClass: 'FACT', text: 'דוד ממתין לתשובה שלושה ימים.', entityEvidence: ['42'] },
      { claimClass: 'RECOMMENDATION', text: 'כדאי לחזור לדוד היום.', evidence: ['42'] },
    ],
    unknown: 'לא ידוע אם נשלחה הודעה בערוץ אחר.',
  },
  evidence: [{ kind: 'lead', refId: '42' }],
  steps: 2,
  stopReason: 'answered',
  investigationId: 'inv_abc123',
}

type FetchSpy = ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>

function mockFetch(status: number, body: unknown): FetchSpy {
  const spy = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

/** Mirrors the existing panel tests exactly: textarea + Enter, wrapped in act. */
async function submit(text: string) {
  const ta = await screen.findByPlaceholderText('שאל את העוזר…')
  await act(async () => {
    fireEvent.change(ta, { target: { value: text } })
    fireEvent.keyDown(ta, { key: 'Enter' })
  })
}

beforeEach(() => {
  // jsdom implements no scrolling; the panel keeps the newest turn in view on
  // every transcript change. Stubbing it is harness plumbing, not behaviour.
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {})
  vi.unstubAllGlobals()
  vi.mocked(getDailyBriefing).mockReset().mockResolvedValue(BRIEFING as never)
  vi.mocked(askGeneralQuestion).mockReset().mockResolvedValue({ kind: 'guide', answer: 'תשובת מדריך' } as never)
})

// ── Default OFF ───────────────────────────────────────────────────────────────

describe('the Agent is off unless the server says otherwise', () => {
  it('uses the existing General Mode action and never calls the API', async () => {
    const f = mockFetch(200, OK_RESULT)
    render(<GeneralModePanel />)
    await submit('מה דורש טיפול?')

    await waitFor(() => expect(askGeneralQuestion).toHaveBeenCalledTimes(1))
    expect(f).not.toHaveBeenCalled()
  })

  it('does not call the existing action when the Agent is enabled', async () => {
    mockFetch(200, OK_RESULT)
    render(<GeneralModePanel agentEnabled />)
    await submit('מה דורש טיפול?')

    await waitFor(() => expect(screen.getByText(OK_RESULT.answer.headline)).toBeInTheDocument())
    expect(askGeneralQuestion).not.toHaveBeenCalled()
  })
})

// ── The request ───────────────────────────────────────────────────────────────

describe('the request', () => {
  it('POSTs to /api/ai/agent', async () => {
    const f = mockFetch(200, OK_RESULT)
    render(<GeneralModePanel agentEnabled />)
    await submit('מה דורש טיפול?')

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    expect(f.mock.calls[0]![0]).toBe('/api/ai/agent')
    expect(f.mock.calls[0]![1].method).toBe('POST')
  })

  it('sends EXACTLY { question } and nothing else', async () => {
    const f = mockFetch(200, OK_RESULT)
    render(<GeneralModePanel agentEnabled />)
    await submit('מה דורש טיפול?')

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String(f.mock.calls[0]![1].body))
    expect(Object.keys(body)).toEqual(['question'])
    expect(body.question).toBe('מה דורש טיפול?')
  })

  it('never sends investigationId back, even after an answer carried one', async () => {
    const f = mockFetch(200, OK_RESULT)
    render(<GeneralModePanel agentEnabled />)
    await submit('שאלה ראשונה')
    await waitFor(() => expect(screen.getByText(OK_RESULT.answer.headline)).toBeInTheDocument())
    await submit('שאלה שנייה')

    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    for (const call of f.mock.calls) {
      const body = JSON.parse(String(call[1].body))
      expect(Object.keys(body)).toEqual(['question'])
      expect(JSON.stringify(body)).not.toContain('inv_abc123')
    }
  })
})

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('a successful investigation renders in the panel conventions', () => {
  it('shows the headline, every claim and the unknown line', async () => {
    mockFetch(200, OK_RESULT)
    render(<GeneralModePanel agentEnabled />)
    await submit('q')

    await waitFor(() => expect(screen.getByText(OK_RESULT.answer.headline)).toBeInTheDocument())
    expect(screen.getByText('דוד ממתין לתשובה שלושה ימים.')).toBeInTheDocument()
    expect(screen.getByText('כדאי לחזור לדוד היום.')).toBeInTheDocument()
    expect(screen.getByText(/לא ידוע אם נשלחה הודעה/)).toBeInTheDocument()
  })

  it('echoes the question as a user turn', async () => {
    mockFetch(200, OK_RESULT)
    render(<GeneralModePanel agentEnabled />)
    await submit('מה דורש טיפול?')
    expect(await screen.findByText('מה דורש טיפול?')).toBeInTheDocument()
  })

  it('never renders internal state — no investigationId, evidence or step count', async () => {
    mockFetch(200, OK_RESULT)
    const { container } = render(<GeneralModePanel agentEnabled />)
    await submit('q')

    await waitFor(() => expect(screen.getByText(OK_RESULT.answer.headline)).toBeInTheDocument())
    expect(container.textContent).not.toContain('inv_abc123')
    expect(container.textContent).not.toContain('refId')
    expect(container.textContent).not.toContain('answered')
  })
})

// ── Loading ───────────────────────────────────────────────────────────────────

describe('loading', () => {
  it('shows the existing loader row while the investigation runs, then clears it', async () => {
    let release: (r: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((res) => { release = res })),
    )
    render(<GeneralModePanel agentEnabled />)
    await submit('q')

    await waitFor(() => expect(screen.getByTestId('loader')).toBeInTheDocument())
    release(new Response(JSON.stringify(OK_RESULT), { status: 200 }))
    await waitFor(() => expect(screen.queryByTestId('loader')).not.toBeInTheDocument())
  })
})

// ── Failure ───────────────────────────────────────────────────────────────────

describe('failures are surfaced, never silent', () => {
  it.each([
    [403, { error: 'subscription-required' }, /מנוי/],
    [404, { error: 'agent-disabled' }, /לא זמין/],
    [401, { error: 'unauthorized' }, /להתחבר/],
    [500, { error: 'unavailable' }, /נסה שוב/],
  ])('an HTTP %s renders a readable message', async (status, body, expected) => {
    mockFetch(status as number, body)
    render(<GeneralModePanel agentEnabled />)
    await submit('q')
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('a network failure renders a readable message rather than failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<GeneralModePanel agentEnabled />)
    await submit('q')
    expect(await screen.findByText(/נסה שוב/)).toBeInTheDocument()
  })

  it('a typed Agent refusal is surfaced as its own message, not an error', async () => {
    mockFetch(200, { ok: false, reason: 'no_evidence', investigationId: 'inv_x' })
    render(<GeneralModePanel agentEnabled />)
    await submit('q')
    expect(await screen.findByText(/לא מצאתי מספיק נתונים/)).toBeInTheDocument()
  })

  it('an admission denial is surfaced without inventing a second authorization mechanism', async () => {
    mockFetch(200, { ok: false, reason: 'gate_denied', message: 'over-quota', investigationId: 'inv_y' })
    render(<GeneralModePanel agentEnabled />)
    await submit('q')
    expect(await screen.findByText(/מכסת/)).toBeInTheDocument()
  })

  it('the composer is usable again after a failure', async () => {
    mockFetch(500, { error: 'unavailable' })
    render(<GeneralModePanel agentEnabled />)
    await submit('q')
    await screen.findByText(/נסה שוב/)
    const ta = await screen.findByPlaceholderText('שאל את העוזר…')
    expect(ta).not.toBeDisabled()
  })
})
