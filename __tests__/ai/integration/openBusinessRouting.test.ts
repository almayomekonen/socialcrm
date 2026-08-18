/**
 * Routing correction: open-ended business questions reach the reasoning pipeline
 * (no longer gated behind the legacy classifier). Two layers of proof:
 *   1) shouldReason routes open-ended business queries IN (and excludes ack/clarify/create/classified/growth);
 *   2) tryReasonedAnswer actually executes the full pipeline for each of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/briefing', () => ({
  getOverdueTaskSummary: vi.fn(),
  getFollowUpsDueToday: vi.fn(),
  getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(),
  getPromisedButWaiting: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
}))
vi.mock('@/lib/ai/router', () => ({ runStructured: vi.fn() }))

import * as briefing from '@/db/briefing'
import { runStructured } from '@/lib/ai/router'
import { shouldReason, tryReasonedAnswer } from '@/lib/copilot/general/reasonedAnswer'

const QUERIES = ['מה לעשות היום?', 'על מה להתמקד?', 'על מי כדאי לעבוד?']
const scope = { user: { role: 'admin' }, gotPermIds: [] } as never
const list = (total: number, sample: unknown[] = []) => ({ total, sample })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(briefing.getOverdueTaskSummary).mockResolvedValue(
    list(3, [{ id: 101, name: 'גיא מלכה', status: 'new', ageDays: 4 }]) as never
  )
  vi.mocked(briefing.getFollowUpsDueToday).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getLeadsNotContactedRecently).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getNewLeadsThisWeek).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getPromisedButWaiting).mockResolvedValue(list(0) as never)
  vi.mocked(briefing.getUnreadInboxSummary).mockResolvedValue({ conversations: 0, unread: 0 } as never)
  vi.mocked(runStructured).mockResolvedValue({
    ok: true,
    data: {
      allClear: false,
      executiveDecision: 'התחל מגיא מלכה.',
      actions: [{ action: 'התקשר לגיא מלכה', why: 'מתקרר', evidence: ['101'], priority: 'high' }],
      moreCount: 2,
    },
  } as never)
})

describe('routing — shouldReason', () => {
  it.each(QUERIES)('routes "%s" to the reasoning pipeline', (q) => {
    expect(shouldReason(q)).toBe(true)
  })

  it('excludes acknowledgements', () => {
    expect(shouldReason('תודה רבה')).toBe(false)
  })
  it('excludes bare interrogatives', () => {
    expect(shouldReason('מה?')).toBe(false)
  })
  it('excludes compose tasks (create)', () => {
    expect(shouldReason('נסח הודעה לדנה')).toBe(false)
  })
  it('excludes summary questions (routed to the deterministic overview, not the Reasoner)', () => {
    expect(shouldReason('מה חדש במערכת?')).toBe(false)
    expect(shouldReason('איך העסק?')).toBe(false)
  })
  it('excludes high-confidence classified questions (narrow CRM Q&A, not the Reasoner)', () => {
    expect(shouldReason('מי שלח הודעות וואטסאפ לאחרונה?')).toBe(false)
    expect(shouldReason('מה הכי דחוף במערכת?')).toBe(false)
    expect(shouldReason('פגישות היום')).toBe(false)
    expect(shouldReason('מי מחכה לי בוואטסאפ?')).toBe(false)
    expect(shouldReason('למי צריך לענות?')).toBe(false)
    expect(shouldReason('מי כתב לי בוואטסאפ?')).toBe(false)
    expect(shouldReason('יש הודעות שלא קראתי?')).toBe(false)
  })
  it('excludes deterministic business-advice questions', () => {
    expect(shouldReason('מה אני יכול לעשות כדי לקדם את העסק?')).toBe(false)
    expect(shouldReason('מה מצב העסק?')).toBe(false)
    expect(shouldReason('מה אתה רואה?')).toBe(false)
    expect(shouldReason('איפה אני מפסיד לידים?')).toBe(false)
  })
})

describe('pipeline executes for every open-ended business query', () => {
  it.each(QUERIES)('produces a reasoned answer for "%s"', async (q) => {
    const ans = await tryReasonedAnswer({ text: q, scope, agencyId: 7 })
    expect(ans?.kind).toBe('reasoned')
    expect(ans!.actions[0].leadId).toBe(101)
  })
})
