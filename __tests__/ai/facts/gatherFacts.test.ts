import { describe, it, expect, vi, beforeEach } from 'vitest'

// The briefing readers hit the DB; mock the whole module so the unit test is
// deterministic and DB-free (VITEST_NO_DB).
vi.mock('@/db/briefing', () => ({
  getOverdueTaskSummary: vi.fn(),
  getFollowUpsDueToday: vi.fn(),
  getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(),
  getPromisedButWaiting: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
}))

import * as briefing from '@/db/briefing'
import { gatherTriageFacts } from '@/lib/copilot/general/facts/gatherFacts'

const scope = { user: { role: 'admin' }, gotPermIds: [] } as never
const list = (total: number, sample: unknown[] = []) => ({ total, sample })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(briefing.getOverdueTaskSummary).mockResolvedValue(
    list(2, [
      { id: 1, name: 'A', status: 'new', ageDays: 3 },
      { id: 2, name: 'B', status: 'open', ageDays: 1 },
    ]) as never
  )
  vi.mocked(briefing.getFollowUpsDueToday).mockResolvedValue(list(1, [{ id: 3, name: 'C', status: 'open', ageDays: null }]) as never)
  vi.mocked(briefing.getLeadsNotContactedRecently).mockResolvedValue(list(0, []) as never)
  vi.mocked(briefing.getNewLeadsThisWeek).mockResolvedValue(list(1, [{ id: 4, name: 'D', status: 'new' }]) as never)
  vi.mocked(briefing.getPromisedButWaiting).mockResolvedValue(list(1, [{ id: 5, name: 'E', status: 'open' }]) as never)
  vi.mocked(briefing.getUnreadInboxSummary).mockResolvedValue({ conversations: 2, unread: 5 } as never)
})

describe('gatherTriageFacts', () => {
  it('gathers every source, tags provenance, and stringifies refIds', async () => {
    const b = await gatherTriageFacts(scope)
    const sources = b.groups.map((g) => g.source)
    expect(sources).toEqual([
      'tasks.overdue',
      'followups.dueToday',
      'leads.notContactedRecently',
      'leads.newThisWeek',
      'followups.promisedWaiting',
      'inbox.unread',
    ])
    const overdue = b.groups.find((g) => g.source === 'tasks.overdue')!
    expect(overdue.total).toBe(2)
    expect(overdue.rows[0].refId).toBe('1') // string, not number
    expect(overdue.rows.every((r) => r.source === 'tasks.overdue')).toBe(true)
  })

  it('maps the count-only inbox source into total + meta', async () => {
    const b = await gatherTriageFacts(scope)
    const inbox = b.groups.find((g) => g.source === 'inbox.unread')!
    expect(inbox.total).toBe(5)
    expect(inbox.rows).toEqual([])
    expect(inbox.meta).toEqual({ conversations: 2, unread: 5 })
  })

  it('degrades a failing reader to an empty group and never throws', async () => {
    vi.mocked(briefing.getOverdueTaskSummary).mockRejectedValue(new Error('db down'))
    const b = await gatherTriageFacts(scope)
    const overdue = b.groups.find((g) => g.source === 'tasks.overdue')!
    expect(overdue.total).toBe(0)
    expect(overdue.rows).toEqual([])
    // other sources remain intact
    expect(b.groups.find((g) => g.source === 'followups.dueToday')!.total).toBe(1)
  })

  it('every row carries a string refId and matches its group source', async () => {
    const b = await gatherTriageFacts(scope)
    for (const g of b.groups) {
      for (const r of g.rows) {
        expect(typeof r.refId).toBe('string')
        expect(r.source).toBe(g.source)
      }
    }
  })
})
