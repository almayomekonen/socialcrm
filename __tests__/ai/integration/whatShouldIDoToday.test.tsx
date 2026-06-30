// @vitest-environment jsdom
/**
 * Milestone 1 — the single end-to-end conversation: "What should I do today?"
 * infer mode → gather deterministic facts → reason → validate → render.
 * Boundaries (DB readers, model, navigation, analytics) are mocked so the whole
 * journey is deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/db/briefing', () => ({
  getOverdueTaskSummary: vi.fn(),
  getFollowUpsDueToday: vi.fn(),
  getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(),
  getPromisedButWaiting: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
}))
vi.mock('@/lib/ai/router', () => ({ runStructured: vi.fn() }))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('@/actions/analytics/recordGeneralModeEvent', () => ({ recordGeneralModeEvent: vi.fn() }))

import * as briefing from '@/db/briefing'
import { runStructured } from '@/lib/ai/router'
import { tryReasonedAnswer } from '@/lib/copilot/general/reasonedAnswer'
import { validateReasoning } from '@/lib/copilot/general/validate'
import { buildDecisionTrace } from '@/lib/copilot/general/decisionTrace'
import type { FactsBundle } from '@/lib/copilot/general/facts/types'
import AnswerView from '@/components/copilot/general/AnswerView'

const scope = { user: { role: 'admin' }, gotPermIds: [] } as never
const list = (total: number, sample: unknown[] = []) => ({ total, sample })

beforeEach(() => {
  vi.clearAllMocks()
  // The one deterministic fact bundle: two overdue items (ids 101, 102), rest empty.
  vi.mocked(briefing.getOverdueTaskSummary).mockResolvedValue(
    list(5, [
      { id: 101, name: 'גיא מלכה', status: 'new', ageDays: 4 },
      { id: 102, name: 'עדי מזרחי', status: 'open', ageDays: 1 },
    ]) as never
  )
  vi.mocked(briefing.getFollowUpsDueToday).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getLeadsNotContactedRecently).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getNewLeadsThisWeek).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getPromisedButWaiting).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getUnreadInboxSummary).mockResolvedValue({ conversations: 0, unread: 0 } as never)
})

const reasoned = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    allClear: false,
    executiveDecision: 'התחל מגיא מלכה — מחכה 4 ימים.',
    actions: [{ action: 'התקשר לגיא מלכה', why: 'ליד שמתקרר אחרי 4 ימים', evidence: ['101'], priority: 'high' }],
    moreCount: 4,
    ...over,
  },
})

describe('Milestone 1 — "What should I do today?"', () => {
  it('produces one validated executive recommendation', async () => {
    vi.mocked(runStructured).mockResolvedValue(reasoned() as never)
    const ans = await tryReasonedAnswer({ text: 'מה לעשות היום?', scope, agencyId: 7, mode: 'smart' })
    expect(ans?.kind).toBe('reasoned')
    expect(ans!.executiveDecision).toContain('גיא מלכה')
    expect(ans!.actions).toHaveLength(1)
    expect(ans!.moreCount).toBe(4)
  })

  it('BENCHMARK (truth): every surfaced action traces to a real fact id', async () => {
    vi.mocked(runStructured).mockResolvedValue(reasoned() as never)
    const ans = await tryReasonedAnswer({ text: 'מה לעשות היום?', scope, agencyId: 7 })
    expect(ans!.actions.every((a) => a.leadId != null && [101, 102].includes(a.leadId))).toBe(true)
  })

  it('falls back (null) when the Trust Gate rejects invented evidence', async () => {
    vi.mocked(runStructured).mockResolvedValue(
      reasoned({ actions: [{ action: 'ghost', why: 'x', evidence: ['999'], priority: 'high' }] }) as never
    )
    expect(await tryReasonedAnswer({ text: 'מה לעשות היום?', scope, agencyId: 7 })).toBeNull()
  })

  it('falls back (null) when the Reasoner fails', async () => {
    vi.mocked(runStructured).mockResolvedValue({ ok: false, reason: 'all-providers-failed' } as never)
    expect(await tryReasonedAnswer({ text: 'מה לעשות היום?', scope, agencyId: 7 })).toBeNull()
  })

  it('stays out of the way for a non-action objective (mode gate, no model call)', async () => {
    const ans = await tryReasonedAnswer({ text: 'נסח הודעה לדנה', scope, agencyId: 7 })
    expect(ans).toBeNull()
    expect(runStructured).not.toHaveBeenCalled()
  })

  it('renders the executive recommendation (the screenshot)', async () => {
    vi.mocked(runStructured).mockResolvedValue(reasoned() as never)
    const ans = await tryReasonedAnswer({ text: 'מה לעשות היום?', scope, agencyId: 7 })
    render(<AnswerView answer={ans!} onPick={() => {}} onPickLead={() => {}} />)
    expect(screen.getByText('התחל מגיא מלכה — מחכה 4 ימים.')).toBeTruthy()
    expect(screen.getByText('התקשר לגיא מלכה').closest('a')?.getAttribute('href')).toBe('/clients/101/summary')
    expect(screen.getByText('ועוד 4')).toBeTruthy()
  })

  it('PROOF: recovers prefixed citations (refId=…) through the Trust Gate to the UI', async () => {
    // The exact production failure: the model echoes the payload's "refId=" citation label.
    const prefixed = { action: 'התקשר לגיא מלכה', why: 'ליד שמתקרר אחרי 4 ימים', evidence: ['refId=101'], priority: 'high' as const }
    vi.mocked(runStructured).mockResolvedValue(reasoned({ actions: [prefixed] }) as never)

    const ans = await tryReasonedAnswer({ text: 'מה לעשות היום?', scope, agencyId: 7 })

    // outcome: NON-fallback — the recommendation now survives validation.
    expect(ans).not.toBeNull()
    expect(ans!.kind).toBe('reasoned')
    expect(ans!.executiveDecision).toContain('גיא מלכה') // ExecutiveDecision produced
    expect(ans!.actions[0]?.leadId).toBe(101) // bare id recovered from "refId=101"

    // Explicit Trust Gate + Decision Trace proof on the same facts (101, 102 overdue).
    const facts: FactsBundle = {
      groups: [
        {
          source: 'tasks.overdue',
          total: 5,
          rows: [
            { refId: '101', name: 'גיא מלכה', status: 'new', ageDays: 4, source: 'tasks.overdue' },
            { refId: '102', name: 'עדי מזרחי', status: 'open', ageDays: 1, source: 'tasks.overdue' },
          ] as never,
        },
      ],
    }
    const modelOut = { allClear: false, executiveDecision: 'התחל מגיא מלכה — מחכה 4 ימים.', actions: [prefixed], moreCount: 4 }
    const validated = validateReasoning(modelOut, facts)
    expect(validated).not.toBeNull()
    expect(validated!.actions[0]!.evidence).toEqual(['101']) // evidence.valid contains the cited id
    expect(validated!.diagnostics.rejectedActions).toEqual([]) // nothing rejected
    expect(validated!.diagnostics.trimmedEvidence).toEqual([]) // removed = []

    const trace = buildDecisionTrace({ objective: 'action', facts, reasoned: modelOut, validated: validated!, startedAt: 0, now: 5, outcome: 'answered' })
    expect(trace.stages.trustValidation!.survivingActions).toBe(1) // trustValidation passes
    expect(trace.outcome).toBe('answered') // non-fallback
    expect(trace.decisionSuccess).toBe(true)

    // The final user-visible response, rendered by AnswerView.
    render(<AnswerView answer={ans!} onPick={() => {}} onPickLead={() => {}} />)
    expect(screen.getByText('התחל מגיא מלכה — מחכה 4 ימים.')).toBeTruthy()
    expect(screen.getByText('התקשר לגיא מלכה').closest('a')?.getAttribute('href')).toBe('/clients/101/summary')
  })
})
