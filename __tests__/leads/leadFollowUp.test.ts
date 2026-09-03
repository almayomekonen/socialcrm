import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the Follow-Up Engine write actions. The integration harness
 * can't bootstrap the DB locally (base `clients` table isn't created by knex
 * migrations here), so we mock db/auth/perms and assert the validation,
 * permission-gating, and payload shaping — the logic most likely to regress.
 */

// Mutable test state the mocks read from.
const state: { role: string; agencyId: number; gotPermIds: number[]; updateResult: unknown[] } = {
  role: 'admin',
  agencyId: 7,
  gotPermIds: [11, 22],
  updateResult: [{ id: 5 }],
}

// Chainable knex-builder mock. `where` returns the builder; `whereIn` returns
// it too; `update().returning()` resolves to state.updateResult.
const spies = {
  db: vi.fn(),
  where: vi.fn(),
  whereIn: vi.fn(),
  update: vi.fn(),
  returning: vi.fn(),
}

vi.mock('@/config/db', () => {
  const returning = (...a: unknown[]) => {
    spies.returning(...a)
    return Promise.resolve(state.updateResult)
  }
  const update = (...a: unknown[]) => {
    spies.update(...a)
    return { returning }
  }
  const builder: Record<string, unknown> = { update }
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

vi.mock('@/lib/requireUser', () => ({
  requireUser: () => Promise.resolve({ id: 99, agencyId: state.agencyId, role: state.role }),
  requireProductAccess: () => Promise.resolve({ id: 99, agencyId: state.agencyId, role: state.role }),
}))
vi.mock('@/db/filter', () => ({ getPerms: () => Promise.resolve({ gotPermIds: state.gotPermIds }) }))
vi.mock('@/types/roles', () => ({ isAdmin: (r: string) => r === 'admin' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
/**
 * `setLeadFollowUp` now emits the `first_follow_up_set` activation milestone via
 * `after()`, which throws outside a request scope. Run it inline against a
 * mocked emitter; the milestone's own behaviour is covered in
 * `__tests__/activation/firstFollowUp.test.ts`.
 */
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(), trackOncePerAgency: vi.fn() }))

import { setLeadFollowUp, clearLeadFollowUp } from '@/actions/leadFollowUp'

beforeEach(() => {
  Object.values(spies).forEach((s) => s.mockClear())
  state.role = 'admin'
  state.agencyId = 7
  state.gotPermIds = [11, 22]
  state.updateResult = [{ id: 5 }]
})

describe('setLeadFollowUp — validation never touches the DB', () => {
  it('rejects a non-positive / non-numeric id', async () => {
    expect(await setLeadFollowUp({ id: 0, at: '2026-06-10' })).toEqual({ err: true, msg: 'ליד לא תקין' })
    expect(await setLeadFollowUp({ id: NaN as unknown as number, at: '2026-06-10' })).toMatchObject({ err: true })
    expect(spies.where).not.toHaveBeenCalled()
  })

  it('rejects an invalid date', async () => {
    const r = await setLeadFollowUp({ id: 5, at: 'not-a-date' })
    expect(r).toEqual({ err: true, msg: 'תאריך לא תקין' })
    expect(spies.where).not.toHaveBeenCalled()
  })
})

describe('setLeadFollowUp — payload + scoping', () => {
  it('writes agency-scoped, trims the note, stamps lastActivityAt, parses ISO date', async () => {
    const r = await setLeadFollowUp({ id: 5, at: '2026-06-10T09:00:00.000Z', note: '  ביקש לחזור  ' })
    expect(r).toEqual({ id: 5 })

    expect(spies.where).toHaveBeenCalledWith({ id: 5, agencyId: 7 })
    const patch = spies.update.mock.calls[0][0] as Record<string, unknown>
    expect(patch.nextFollowUpAt).toBeInstanceOf(Date)
    expect((patch.nextFollowUpAt as Date).toISOString()).toBe('2026-06-10T09:00:00.000Z')
    expect(patch.followUpNote).toBe('ביקש לחזור')
    expect(patch.lastActivityAt).toBeInstanceOf(Date)
    expect(patch.updatedAt).toBeInstanceOf(Date)
  })

  it('empty/whitespace note becomes null', async () => {
    await setLeadFollowUp({ id: 5, at: '2026-06-10', note: '   ' })
    expect((spies.update.mock.calls[0][0] as Record<string, unknown>).followUpNote).toBeNull()
  })

  it('admin is NOT permission-filtered; non-admin IS', async () => {
    await setLeadFollowUp({ id: 5, at: '2026-06-10' })
    expect(spies.whereIn).not.toHaveBeenCalled()

    spies.whereIn.mockClear()
    state.role = 'rep'
    await setLeadFollowUp({ id: 5, at: '2026-06-10' })
    expect(spies.whereIn).toHaveBeenCalledWith('userId', [11, 22])
  })

  it('returns an error when no row matched (not found / no permission)', async () => {
    state.updateResult = []
    expect(await setLeadFollowUp({ id: 5, at: '2026-06-10' })).toEqual({ err: true, msg: 'הליד לא נמצא' })
  })
})

describe('clearLeadFollowUp', () => {
  it('nulls both follow-up columns and stamps activity', async () => {
    const r = await clearLeadFollowUp({ id: 5 })
    expect(r).toEqual({ id: 5 })
    const patch = spies.update.mock.calls[0][0] as Record<string, unknown>
    expect(patch.nextFollowUpAt).toBeNull()
    expect(patch.followUpNote).toBeNull()
    expect(patch.lastActivityAt).toBeInstanceOf(Date)
  })

  it('rejects invalid id without hitting the DB', async () => {
    expect(await clearLeadFollowUp({ id: -1 })).toEqual({ err: true, msg: 'ליד לא תקין' })
    expect(spies.where).not.toHaveBeenCalled()
  })
})
