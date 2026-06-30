import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the model substrate so the Reasoner is tested deterministically (no model, no DB).
vi.mock('@/lib/ai/router', () => ({ runStructured: vi.fn() }))

import { runStructured } from '@/lib/ai/router'
import { reasonOverFacts } from '@/lib/copilot/general/reason'
import { GENERAL_REASON_SCHEMA, type GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'
import type { FactsBundle } from '@/lib/copilot/general/facts/types'

const facts: FactsBundle = {
  groups: [
    {
      source: 'tasks.overdue',
      total: 2,
      rows: [
        { refId: '1', name: 'גיא מלכה', status: 'new', ageDays: 4, source: 'tasks.overdue' },
        { refId: '2', name: 'עדי מזרחי', status: null, ageDays: 1, source: 'tasks.overdue' },
      ],
    },
    { source: 'followups.dueToday', total: 0, rows: [] }, // empty — should be skipped
    { source: 'inbox.unread', total: 3, rows: [], meta: { conversations: 2, unread: 3 } },
  ],
}

const sample: GeneralReasonOutput = {
  allClear: false,
  executiveDecision: 'התחל מגיא מלכה — מחכה 4 ימים.',
  actions: [{ action: 'התקשר לגיא מלכה', why: 'ליד שמתקרר אחרי 4 ימים', evidence: ['1'], priority: 'high' }],
  moreCount: 5,
}

beforeEach(() => vi.clearAllMocks())

describe('reasonOverFacts', () => {
  it('calls the Reasoner task with the personality prompt and decision schema', async () => {
    vi.mocked(runStructured).mockResolvedValue({ ok: true, data: sample } as never)
    await reasonOverFacts('action', facts, { agencyId: 7, mode: 'smart' })

    const call = vi.mocked(runStructured).mock.calls[0][0]
    expect(call.kind).toBe('copilot.generalReason')
    expect(call.schema).toBe(GENERAL_REASON_SCHEMA)
    expect(call.system).toMatch(/ראש צוות מנוסה/) // identity-first, not a summarizer
    expect(call.system).toMatch(/החלטות טובות יותר/) // success measured by better decisions
  })

  it('feeds the model the facts with citable refIds and human labels, skipping empty groups', async () => {
    vi.mocked(runStructured).mockResolvedValue({ ok: true, data: sample } as never)
    await reasonOverFacts('action', facts, { agencyId: 7 })

    const user = vi.mocked(runStructured).mock.calls[0][0].user
    expect(user).toContain('refId=1') // citation key present for the Trust Gate later
    expect(user).toContain('משימות באיחור') // neutral state label, not the internal source id
    expect(user).toContain('ממתינים בתיבה') // inbox count surfaced
    expect(user).not.toContain('followups.dueToday') // empty group skipped
    expect(user).toContain('מטרת המשתמש: action')
  })

  it('routes the model role from the Copilot mode', async () => {
    vi.mocked(runStructured).mockResolvedValue({ ok: true, data: sample } as never)
    await reasonOverFacts('action', facts, { agencyId: 7, mode: 'fast' })
    expect(vi.mocked(runStructured).mock.calls[0][0].roleOverride).toBe('volume') // fast → volume
  })

  it('returns the executive recommendation on success', async () => {
    vi.mocked(runStructured).mockResolvedValue({ ok: true, data: sample } as never)
    const out = await reasonOverFacts('action', facts, { agencyId: 7 })
    expect(out).toEqual(sample)
  })

  it('returns null on model failure so the orchestrator can fall back safely', async () => {
    vi.mocked(runStructured).mockResolvedValue({ ok: false, reason: 'all-providers-failed' } as never)
    const out = await reasonOverFacts('action', facts, { agencyId: 7 })
    expect(out).toBeNull()
  })
})

describe('GENERAL_REASON_SCHEMA (decision-shaped)', () => {
  it('accepts a valid executive recommendation', () => {
    expect(GENERAL_REASON_SCHEMA.safeParse(sample).success).toBe(true)
  })

  it('accepts the all-clear (silence is valid)', () => {
    const allClear: GeneralReasonOutput = { allClear: true, executiveDecision: 'הכול תחת שליטה.', actions: [], moreCount: 0 }
    expect(GENERAL_REASON_SCHEMA.safeParse(allClear).success).toBe(true)
  })

  it('requires action/why/evidence/priority on every action', () => {
    const bad = { ...sample, actions: [{ action: 'x', why: 'y' }] }
    expect(GENERAL_REASON_SCHEMA.safeParse(bad).success).toBe(false)
  })
})
