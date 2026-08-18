import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/quota', () => ({ getEffectiveLeadPlan: vi.fn() }))
vi.mock('@/db/inboxWaiting', () => ({ oldestWaitingWhatsappQuery: vi.fn() }))

import { getEffectiveLeadPlan } from '@/lib/quota'
import { oldestWaitingWhatsappQuery } from '@/db/inboxWaiting'
import {
  countWaitingWhatsappConversations,
  listWaitingWhatsappLeads,
  listWaitingWhatsappRows,
} from '@/lib/copilot/general/waitingInbound'
import { Roles } from '@/types/roles'

const user = { agencyId: 10, id: 1, role: Roles.ADMIN }
const scope = { user: { role: Roles.ADMIN }, gotPermIds: [1] }

function row(i: number) {
  return {
    leadId: i,
    name: `Lead ${i}`,
    status: null,
    lastInboundAt: new Date('2026-08-18T10:00:00.000Z'),
  }
}

/** Fresh knex-like thenable: LIMIT slices preview; countDistinct.first returns the full N. */
function makeQuery(allRows: ReturnType<typeof row>[]) {
  let slice = allRows
  const chain: {
    orderBy: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    clearSelect: ReturnType<typeof vi.fn>
    countDistinct: ReturnType<typeof vi.fn>
    first: ReturnType<typeof vi.fn>
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise<unknown>
  } = {
    orderBy: vi.fn(),
    limit: vi.fn(),
    clearSelect: vi.fn(),
    countDistinct: vi.fn(),
    first: vi.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(slice).then(onFulfilled, onRejected),
  }
  chain.orderBy.mockReturnValue(chain)
  chain.limit.mockImplementation((n: number) => {
    slice = allRows.slice(0, n)
    return chain
  })
  chain.clearSelect.mockReturnValue(chain)
  chain.countDistinct.mockReturnValue(chain)
  chain.first.mockResolvedValue({ n: String(allRows.length) })
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getEffectiveLeadPlan).mockResolvedValue('pro' as never)
})

describe('waiting inbound COUNT vs LIMIT preview', () => {
  it('preview may return 8 while total is the real count of 9+', async () => {
    const all = Array.from({ length: 9 }, (_, i) => row(i + 1))
    vi.mocked(oldestWaitingWhatsappQuery).mockImplementation(() => makeQuery(all) as never)

    const [rows, total, listed] = await Promise.all([
      listWaitingWhatsappRows(user, scope, 'asc'),
      countWaitingWhatsappConversations(user, scope),
      listWaitingWhatsappLeads(user, scope),
    ])

    expect(rows).toHaveLength(8)
    expect(listed.sample).toHaveLength(8)
    expect(total).toBe(9)
    expect(listed.total).toBe(9)
    expect(listed.total).not.toBe(listed.sample.length)
    expect(oldestWaitingWhatsappQuery).toHaveBeenCalled()
  })

  it('uses COUNT, never preview length, when fewer than the LIMIT', async () => {
    const all = [row(1), row(2)]
    vi.mocked(oldestWaitingWhatsappQuery).mockImplementation(() => makeQuery(all) as never)
    const listed = await listWaitingWhatsappLeads(user, scope)
    expect(listed.sample).toHaveLength(2)
    expect(listed.total).toBe(2)
  })
})
