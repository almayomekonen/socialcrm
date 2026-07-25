import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * hasAnyLeads admin-scoping fix: admins must NOT be filtered by userId (their
 * gotPermIds is []), reps must stay scoped. db/auth/quota mocked (no DB locally).
 */

const state = { plan: 'pro', count: 0, isAdminResult: false, whereInCalled: false, whereInArgs: [] as unknown[] }

const builder: Record<string, unknown> = {}
builder.where = () => builder
builder.whereIn = (...a: unknown[]) => {
  state.whereInCalled = true
  state.whereInArgs = a
  return builder
}
builder.count = () => ({ first: () => Promise.resolve({ count: state.count }) })

vi.mock('@/config/db', () => ({ db: () => builder }))
vi.mock('@/lib/quota', () => ({ getEffectiveLeadPlan: () => Promise.resolve(state.plan) }))
vi.mock('@/types/roles', () => ({ isAdmin: () => state.isAdminResult }))

import { hasAnyLeads } from '@/db/clients'

beforeEach(() => {
  state.plan = 'pro'
  state.count = 0
  state.isAdminResult = false
  state.whereInCalled = false
  state.whereInArgs = []
})

describe('hasAnyLeads — admin scoping', () => {
  it('admin WITH leads → true, NOT filtered by userId', async () => {
    state.isAdminResult = true
    state.count = 5
    expect(await hasAnyLeads(122, [], 'ADMIN' as never)).toBe(true)
    expect(state.whereInCalled).toBe(false) // admin bypass: no userId filter
  })

  it('admin with NO leads → false (genuine empty system → onboarding redirect), still not filtered', async () => {
    state.isAdminResult = true
    state.count = 0
    expect(await hasAnyLeads(122, [], 'ADMIN' as never)).toBe(false)
    expect(state.whereInCalled).toBe(false)
  })

  it('rep WITH permitted leads → true, scoped by userId', async () => {
    state.isAdminResult = false
    state.count = 3
    expect(await hasAnyLeads(122, [359, 360], 'AGENT' as never)).toBe(true)
    expect(state.whereInCalled).toBe(true)
    expect(state.whereInArgs).toEqual(['userId', [359, 360]])
  })

  it('rep with NO permitted leads → false, scoped by userId', async () => {
    state.isAdminResult = false
    state.count = 0
    expect(await hasAnyLeads(122, [777], 'AGENT' as never)).toBe(false)
    expect(state.whereInCalled).toBe(true)
  })
})
