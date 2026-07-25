/**
 * Product-access authorization: getAgencyProductAccess (canonical resolver) and
 * requireProductAccess (the product-boundary guard). db is mocked; unique
 * agencyIds per case avoid React cache() memoization across cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const trial = { row: undefined as unknown, throws: false }
const auth = { user: null as unknown }

vi.mock('@/db/trial', () => ({
  getAgencyTrial: () => (trial.throws ? Promise.reject(new Error('db down')) : Promise.resolve(trial.row)),
}))
vi.mock('@/db/auth', () => ({ getUser: () => Promise.resolve(auth.user) }))

import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { requireProductAccess, ProductAccessError, AuthError } from '@/lib/requireUser'

const DAY = 86_400_000
const NOW = Date.now()
const ROW = {
  PAID: { plan: 'pro', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
  LEGACY: { plan: 'free', trialExempt: true, trialStartedAt: null, trialEndsAt: null },
  TRIAL_ACTIVE: { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - DAY), trialEndsAt: new Date(NOW + 3 * DAY) },
  TRIAL_EXPIRED: { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - 8 * DAY), trialEndsAt: new Date(NOW - DAY) },
  NEVER_STARTED: { plan: 'free', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
}
let id = 1000
const uid = () => ++id // unique agencyId per case (defeats cache() memoization)

beforeEach(() => {
  trial.row = undefined
  trial.throws = false
  auth.user = { id: 7, agencyId: 1, suspended: false }
})

describe('getAgencyProductAccess — canonical resolver', () => {
  it.each([
    ['PAID', ROW.PAID, true, 'PAID'],
    ['TRIAL_ACTIVE', ROW.TRIAL_ACTIVE, true, 'TRIAL_ACTIVE'],
    ['LEGACY', ROW.LEGACY, true, 'LEGACY'],
    ['TRIAL_EXPIRED', ROW.TRIAL_EXPIRED, false, 'TRIAL_EXPIRED'],
    ['NEVER_STARTED', ROW.NEVER_STARTED, false, 'NEVER_STARTED'],
  ])('%s → hasAccess=%s', async (_n, row, hasAccess, status) => {
    trial.row = row
    const a = await getAgencyProductAccess(uid())
    expect(a).toEqual({ status, hasAccess })
  })

  it('DB read error → fail OPEN (never blocks a paying customer)', async () => {
    trial.throws = true
    expect(await getAgencyProductAccess(uid())).toEqual({ status: 'UNKNOWN', hasAccess: true })
  })
  it('missing agency row → fail OPEN', async () => {
    trial.row = undefined
    expect(await getAgencyProductAccess(uid())).toEqual({ status: 'UNKNOWN', hasAccess: true })
  })
})

describe('requireProductAccess — product-boundary guard', () => {
  it.each([
    ['PAID', ROW.PAID],
    ['TRIAL_ACTIVE', ROW.TRIAL_ACTIVE],
    ['LEGACY', ROW.LEGACY],
  ])('%s → returns the authenticated agency user (allowed)', async (_n, row) => {
    auth.user = { id: 7, agencyId: uid(), suspended: false }
    trial.row = row
    const user = await requireProductAccess()
    expect(user.agencyId).toBe((auth.user as { agencyId: number }).agencyId)
  })

  it('TRIAL_EXPIRED → throws ProductAccessError(subscription-required)', async () => {
    auth.user = { id: 7, agencyId: uid(), suspended: false }
    trial.row = ROW.TRIAL_EXPIRED
    await expect(requireProductAccess()).rejects.toMatchObject({
      name: 'ProductAccessError',
      reason: 'subscription-required',
    })
  })
  it('NEVER_STARTED → throws ProductAccessError(trial-not-started)', async () => {
    auth.user = { id: 7, agencyId: uid(), suspended: false }
    trial.row = ROW.NEVER_STARTED
    await expect(requireProductAccess()).rejects.toMatchObject({
      name: 'ProductAccessError',
      reason: 'trial-not-started',
    })
  })

  it('DB read error → fail OPEN (allowed) — transient infra never locks out', async () => {
    auth.user = { id: 7, agencyId: uid(), suspended: false }
    trial.throws = true
    const user = await requireProductAccess()
    expect(user).toBeTruthy()
  })

  it('unauthenticated → AuthError BEFORE any access check (identity first)', async () => {
    auth.user = null
    await expect(requireProductAccess()).rejects.toBeInstanceOf(AuthError)
  })

  it('authorization uses the SESSION agency, never a client-provided id', async () => {
    // No agencyId argument exists; the guard reads it from the session user.
    auth.user = { id: 7, agencyId: uid(), suspended: false }
    trial.row = ROW.PAID
    const user = await requireProductAccess()
    expect(user.agencyId).toBe((auth.user as { agencyId: number }).agencyId)
  })
})
