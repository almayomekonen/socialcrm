/**
 * lib/quota — effective-access lead quota. Proves the Phase-1 fix: an active
 * trial (and a legacy agency) is uncapped even though its subscription plan is
 * still 'free', while expired / never-started accounts are NOT accidentally
 * granted unlimited access. db + devBypass are mocked (no live DB, mirrors
 * __tests__/leads/hasAnyLeads.test.ts) so the logic is exercised in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const DAY = 86_400_000
const NOW = Date.now()

type AgencyRow = {
  plan: 'free' | 'pro'
  trialExempt: boolean
  trialStartedAt: Date | null
  trialEndsAt: Date | null
}

const ROWS: Record<string, AgencyRow> = {
  PAID: { plan: 'pro', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
  LEGACY: { plan: 'free', trialExempt: true, trialStartedAt: null, trialEndsAt: null },
  TRIAL_ACTIVE: {
    plan: 'free',
    trialExempt: false,
    trialStartedAt: new Date(NOW - DAY),
    trialEndsAt: new Date(NOW + 3 * DAY),
  },
  TRIAL_EXPIRED: {
    plan: 'free',
    trialExempt: false,
    trialStartedAt: new Date(NOW - 8 * DAY),
    trialEndsAt: new Date(NOW - DAY),
  },
  NEVER_STARTED: { plan: 'free', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
}

const state = {
  agencyRow: null as AgencyRow | null,
  devBypass: false,
  visibleCount: 0, // clients with overQuota=false
  overCount: 0, // clients with overQuota=true
}

vi.mock('@/lib/auth/devBypass', () => ({
  isDevBypassAgency: () => Promise.resolve(state.devBypass),
}))

vi.mock('@/config/db', () => {
  const dbFn = (table: string) => {
    const where: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    builder.where = (arg: Record<string, unknown>) => {
      if (arg && typeof arg === 'object') Object.assign(where, arg)
      return builder
    }
    builder.select = () => builder
    builder.first = () => Promise.resolve(table === 'agencies' ? (state.agencyRow ?? undefined) : undefined)
    builder.count = () => ({
      first: () => {
        const c = where.overQuota === true ? state.overCount : state.visibleCount
        return Promise.resolve({ count: String(c) })
      },
    })
    return builder
  }
  return { db: dbFn }
})

import { getEffectiveLeadPlan, assertLeadQuota, getQuotaStatus, QuotaExceededError, FREE_LEAD_LIMIT } from '@/lib/quota'

beforeEach(() => {
  state.agencyRow = null
  state.devBypass = false
  state.visibleCount = 0
  state.overCount = 0
})

describe('getEffectiveLeadPlan — access, not subscription', () => {
  it('PAID → pro', async () => {
    state.agencyRow = ROWS.PAID
    expect(await getEffectiveLeadPlan(1)).toBe('pro')
  })

  it('TRIAL_ACTIVE → pro even though subscription plan is free', async () => {
    state.agencyRow = ROWS.TRIAL_ACTIVE
    expect(state.agencyRow.plan).toBe('free') // subscription still free
    expect(await getEffectiveLeadPlan(1)).toBe('pro') // but effective access is full
  })

  it('LEGACY → pro', async () => {
    state.agencyRow = ROWS.LEGACY
    expect(await getEffectiveLeadPlan(1)).toBe('pro')
  })

  it('TRIAL_EXPIRED → free (not accidentally unlimited)', async () => {
    state.agencyRow = ROWS.TRIAL_EXPIRED
    expect(await getEffectiveLeadPlan(1)).toBe('free')
  })

  it('NEVER_STARTED → free (not accidentally unlimited)', async () => {
    state.agencyRow = ROWS.NEVER_STARTED
    expect(await getEffectiveLeadPlan(1)).toBe('free')
  })

  it('dev/owner bypass → pro regardless of row', async () => {
    state.devBypass = true
    state.agencyRow = ROWS.TRIAL_EXPIRED
    expect(await getEffectiveLeadPlan(1)).toBe('pro')
  })

  it('missing agency row → free (fail safe)', async () => {
    state.agencyRow = null
    expect(await getEffectiveLeadPlan(999)).toBe('free')
  })
})

describe('assertLeadQuota — trial is uncapped, expired is not', () => {
  const OVER = FREE_LEAD_LIMIT + 10 // 60

  it('TRIAL_ACTIVE with 60 visible leads → does NOT throw (the live 50-cap bug is fixed)', async () => {
    state.agencyRow = ROWS.TRIAL_ACTIVE
    state.visibleCount = OVER
    await expect(assertLeadQuota(1, 1)).resolves.toBeUndefined()
  })

  it('PAID with 60 visible leads → does NOT throw', async () => {
    state.agencyRow = ROWS.PAID
    state.visibleCount = OVER
    await expect(assertLeadQuota(1, 1)).resolves.toBeUndefined()
  })

  it('LEGACY with 60 visible leads → does NOT throw', async () => {
    state.agencyRow = ROWS.LEGACY
    state.visibleCount = OVER
    await expect(assertLeadQuota(1, 1)).resolves.toBeUndefined()
  })

  it('TRIAL_EXPIRED at the cap → throws QuotaExceededError (still restricted)', async () => {
    state.agencyRow = ROWS.TRIAL_EXPIRED
    state.visibleCount = FREE_LEAD_LIMIT
    await expect(assertLeadQuota(1, 1)).rejects.toBeInstanceOf(QuotaExceededError)
  })

  it('NEVER_STARTED at the cap → throws QuotaExceededError (still restricted)', async () => {
    state.agencyRow = ROWS.NEVER_STARTED
    state.visibleCount = FREE_LEAD_LIMIT
    await expect(assertLeadQuota(1, 1)).rejects.toBeInstanceOf(QuotaExceededError)
  })

  it('TRIAL_EXPIRED below the cap → still allowed (behavior unchanged for restricted plans)', async () => {
    state.agencyRow = ROWS.TRIAL_EXPIRED
    state.visibleCount = FREE_LEAD_LIMIT - 1
    await expect(assertLeadQuota(1, 1)).resolves.toBeUndefined()
  })
})

describe('getQuotaStatus — drives banners + webhook overQuota flag', () => {
  // The webhook creators compute: overQuota = quota.plan === 'free' && limit !== null && used >= limit
  const wouldFlagOverQuota = (q: { plan: string; limit: number | null; used: number }) =>
    q.plan === 'free' && q.limit !== null && q.used >= q.limit

  it('TRIAL_ACTIVE past 50 → uncapped status, so webhook lead #51+ is NOT flagged overQuota', async () => {
    state.agencyRow = ROWS.TRIAL_ACTIVE
    state.visibleCount = 60
    state.overCount = 0
    const status = await getQuotaStatus(1)
    expect(status.plan).toBe('pro')
    expect(status.limit).toBeNull()
    expect(status.remaining).toBeNull()
    expect(status.overQuotaCount).toBe(0)
    expect(wouldFlagOverQuota(status)).toBe(false)
  })

  it('TRIAL_EXPIRED past 50 → capped status, webhook lead #51+ IS flagged (restricted, unchanged)', async () => {
    state.agencyRow = ROWS.TRIAL_EXPIRED
    state.visibleCount = 60
    const status = await getQuotaStatus(1)
    expect(status.plan).toBe('free')
    expect(status.limit).toBe(FREE_LEAD_LIMIT)
    expect(wouldFlagOverQuota(status)).toBe(true)
  })
})
