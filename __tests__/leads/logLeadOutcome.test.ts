import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Action-level tests for logLeadOutcome (db/auth mocked, since the integration
 * harness can't bootstrap the DB locally). Asserts the write PATCH for each
 * outcome: status transitions, follow-up creation, terminal clearing, override,
 * and permission scoping on both the status-read and the write.
 */

const state: { role: string; agencyId: number; gotPermIds: number[]; status: string | null | undefined; updateResult: unknown[] } = {
  role: 'admin',
  agencyId: 7,
  gotPermIds: [11, 22],
  status: 'new',
  updateResult: [{ id: 5 }],
}

const spies = { db: vi.fn(), where: vi.fn(), whereIn: vi.fn(), first: vi.fn(), update: vi.fn(), returning: vi.fn() }

vi.mock('@/config/db', () => {
  const returning = (...a: unknown[]) => {
    spies.returning(...a)
    return Promise.resolve(state.updateResult)
  }
  const update = (...a: unknown[]) => {
    spies.update(...a)
    return { returning }
  }
  const first = (...a: unknown[]) => {
    spies.first(...a)
    return Promise.resolve(state.status === undefined ? undefined : { status: state.status })
  }
  const builder: Record<string, unknown> = { update, first }
  builder.whereIn = (...a: unknown[]) => {
    spies.whereIn(...a)
    return builder
  }
  const where = (...a: unknown[]) => {
    spies.where(...a)
    return builder
  }
  const db = (...a: unknown[]) => {
    spies.db(...a)
    return { where }
  }
  return { db }
})
vi.mock('@/lib/requireUser', () => ({ requireUser: () => Promise.resolve({ id: 99, agencyId: state.agencyId, role: state.role }) }))
vi.mock('@/db/filter', () => ({ getPerms: () => Promise.resolve({ gotPermIds: state.gotPermIds }) }))
vi.mock('@/types/roles', () => ({ isAdmin: (r: string) => r === 'admin' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/scheduleWarm', () => ({ scheduleLeadIntelWarm: vi.fn() }))

import { logLeadOutcome } from '@/actions/leadOutcome'

const patch = () => spies.update.mock.calls[0][0] as Record<string, unknown>

beforeEach(() => {
  Object.values(spies).forEach((s) => s.mockClear())
  state.role = 'admin'
  state.agencyId = 7
  state.gotPermIds = [11, 22]
  state.status = 'new'
  state.updateResult = [{ id: 5 }]
})

describe('logLeadOutcome — validation', () => {
  it('rejects invalid id', async () => expect(await logLeadOutcome({ id: 0, outcome: 'call_reached' })).toMatchObject({ err: true }))
  it('rejects unknown outcome', async () =>
    expect(await logLeadOutcome({ id: 5, outcome: 'call_won' as never })).toMatchObject({ err: true }))
  it('lead not found (status read empty) → error, no write', async () => {
    state.status = undefined
    expect(await logLeadOutcome({ id: 5, outcome: 'call_reached' })).toMatchObject({ err: true })
    expect(spies.update).not.toHaveBeenCalled()
  })
})

describe('logLeadOutcome — outcome patches', () => {
  it('no_answer: outcome + activity stamped, retry tomorrow, NO status change', async () => {
    state.status = 'contacted'
    await logLeadOutcome({ id: 5, outcome: 'call_no_answer' })
    const p = patch()
    expect(p.lastOutcomeType).toBe('call_no_answer')
    expect(p.lastActivityAt).toBeInstanceOf(Date)
    expect('status' in p).toBe(false)
    expect('statusChangedAt' in p).toBe(false)
    expect(p.nextFollowUpAt).toBeInstanceOf(Date)
  })

  it('reached on NEW → status contacted + statusChangedAt + follow-up', async () => {
    state.status = 'new'
    await logLeadOutcome({ id: 5, outcome: 'call_reached' })
    const p = patch()
    expect(p.status).toBe('contacted')
    expect(p.statusChangedAt).toBeInstanceOf(Date)
    expect(p.nextFollowUpAt).toBeInstanceOf(Date)
  })

  it('reached on INTERESTED → no status change (no downgrade)', async () => {
    state.status = 'interested'
    await logLeadOutcome({ id: 5, outcome: 'call_reached' })
    expect('status' in patch()).toBe(false)
  })

  it('interested → status interested + follow-up', async () => {
    state.status = 'contacted'
    await logLeadOutcome({ id: 5, outcome: 'call_interested' })
    const p = patch()
    expect(p.status).toBe('interested')
    expect(p.nextFollowUpAt).toBeInstanceOf(Date)
  })

  it('not_interested (terminal) → status lost + follow-up CLEARED', async () => {
    state.status = 'interested'
    await logLeadOutcome({ id: 5, outcome: 'call_not_interested' })
    const p = patch()
    expect(p.status).toBe('lost')
    expect(p.nextFollowUpAt).toBeNull()
    expect(p.followUpNote).toBeNull()
  })

  it('honors an explicit followUpAt override', async () => {
    await logLeadOutcome({ id: 5, outcome: 'call_reached', followUpAt: '2026-07-01T00:00:00.000Z' })
    expect((patch().nextFollowUpAt as Date).toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('interested on LOST reopens → status interested', async () => {
    state.status = 'lost'
    await logLeadOutcome({ id: 5, outcome: 'call_interested' })
    expect(patch().status).toBe('interested')
  })

  it.each(['closed', 'lost'])('not_interested on %s → no status write (no needless statusChangedAt)', async (s) => {
    state.status = s
    await logLeadOutcome({ id: 5, outcome: 'call_not_interested' })
    const p = patch()
    expect('status' in p).toBe(false)
    expect('statusChangedAt' in p).toBe(false)
    expect(p.nextFollowUpAt).toBeNull() // still clears follow-up
  })

  it('interested on CLOSED → no status write', async () => {
    state.status = 'closed'
    await logLeadOutcome({ id: 5, outcome: 'call_interested' })
    expect('status' in patch()).toBe(false)
  })

  it('reschedule WITHOUT a note preserves the existing note (followUpNote untouched)', async () => {
    await logLeadOutcome({ id: 5, outcome: 'call_no_answer' })
    expect('followUpNote' in patch()).toBe(false)
  })

  it('rejects an invalid override date', async () => {
    expect(await logLeadOutcome({ id: 5, outcome: 'call_reached', followUpAt: 'not-a-date' })).toMatchObject({ err: true })
  })
})

describe('logLeadOutcome — scoping', () => {
  it('non-admin is permission-filtered on read AND write', async () => {
    state.role = 'rep'
    await logLeadOutcome({ id: 5, outcome: 'call_no_answer' })
    expect(spies.whereIn).toHaveBeenCalledTimes(2)
    expect(spies.whereIn).toHaveBeenCalledWith('userId', [11, 22])
  })

  it('admin is NOT permission-filtered', async () => {
    await logLeadOutcome({ id: 5, outcome: 'call_no_answer' })
    expect(spies.whereIn).not.toHaveBeenCalled()
  })
})
