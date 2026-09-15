import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { runChargePass, type PassDeps } from '@/lib/payments/charges/runChargePass'
import { reconcileUnknownCharges, growChargeReconciler } from '@/lib/payments/charges/reconcileUnknown'
import { seedAgency, seedMethod, seedSubscription, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'staging')
  vi.stubEnv('GROW_MODE', 'sandbox')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
  vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

async function dueTrial() {
  const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-0.5) })
  const pm = await seedMethod(agencyId)
  await seedSubscription(agencyId)
  return { agencyId, pm }
}
const fakeDeps = (dispatchAllowed: boolean): PassDeps & { execute: ReturnType<typeof vi.fn> } => ({
  execute: vi.fn(async () => 'succeeded' as const),
  reconcile: vi.fn(async () => ({ paid: 0, notCharged: 0, undetermined: 0 })),
  dispatchAllowed: () => dispatchAllowed,
  clock: () => Date.now(),
})

describe('runChargePass', () => {
  it('does nothing — not even a database read — while SUBSCRIPTION_CHARGES_ENABLED is absent', async () => {
    const { agencyId } = await dueTrial()
    const deps = fakeDeps(true)
    expect(await runChargePass(deps)).toMatchObject({ enabled: false, dispatch: false })
    expect(deps.reconcile).not.toHaveBeenCalled()
    expect(await db('billing_charges').where({ agencyId })).toHaveLength(0)
  })

  it('refuses a runtime that may not call Grow', async () => {
    vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', 'true')
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', '')
    await expect(runChargePass(fakeDeps(true))).rejects.toThrow('grow.runtime.sandbox_requires_isolated_data')
  })

  it('persists due attempts but dispatches nothing while dispatch is not established', async () => {
    vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', 'true')
    const { agencyId } = await dueTrial()
    const deps = fakeDeps(false)
    expect(await runChargePass(deps)).toMatchObject({ enabled: true, dispatch: false, scheduled: { conversions: 1 } })
    expect(deps.execute).not.toHaveBeenCalled()
    expect(await db('billing_charges').where({ agencyId }).first()).toMatchObject({ status: 'pending', dispatchedAt: null })
  })

  it('executes claimed charges one at a time when dispatch is allowed (test gate only)', async () => {
    vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', 'true')
    const { agencyId } = await dueTrial()
    const deps = fakeDeps(true)
    const summary = await runChargePass(deps)
    const [charge] = await db('billing_charges').where({ agencyId })
    expect(deps.execute).toHaveBeenCalledWith(Number(charge.id))
    expect(summary.executed.succeeded).toBeGreaterThanOrEqual(1)
  })
})

describe('reconcileUnknownCharges', () => {
  it('the live reconciler leaves unknown outcomes untouched: no retry, no success, on a guess', async () => {
    const { agencyId, pm } = await dueTrial()
    const id = await seedCharge(agencyId, pm, { status: 'unknown', dispatchedAt: new Date() })
    expect(await growChargeReconciler((await db('billing_charges').where({ id }).first()) as never)).toEqual({ kind: 'undetermined', reason: 'provider_evidence_missing' })
    const summary = await reconcileUnknownCharges(50)
    expect(summary.undetermined).toBeGreaterThanOrEqual(1)
    expect(await db('billing_charges').where({ agencyId })).toHaveLength(1)
    expect((await db('billing_charges').where({ id }).first()).status).toBe('unknown')
  })

  it('a not_charged verdict (local test double) schedules a new attempt with the same group identifier', async () => {
    const { agencyId, pm } = await dueTrial()
    const id = await seedCharge(agencyId, pm, { status: 'unknown', dispatchedAt: new Date(), groupIdentifier: 777 })
    await reconcileUnknownCharges(50, async (c) => (c.id === id ? { kind: 'not_charged' } : { kind: 'undetermined', reason: 'other' }))
    const rows = await db('billing_charges').where({ agencyId }).orderBy('id')
    expect(rows[0]).toMatchObject({ status: 'failed_retryable', errorClass: 'reconciled_not_charged' })
    expect(rows[1]).toMatchObject({ attempt: 2, status: 'pending', groupIdentifier: '777' })
  })

  it('a paid verdict (local test double) settles through Model B', async () => {
    const { agencyId, pm } = await dueTrial()
    const id = await seedCharge(agencyId, pm, { status: 'unknown', dispatchedAt: new Date() })
    await reconcileUnknownCharges(50, async (c) =>
      c.id === id ? { kind: 'paid', paid: { transactionId: `rec-${agencyId}`, transactionToken: null, asmachta: null, statusCode: '2' } } : { kind: 'undetermined', reason: 'other' },
    )
    expect((await db('billing_charges').where({ id }).first()).status).toBe('succeeded')
    expect((await db('agencies').where({ id: agencyId }).first()).plan).toBe('pro')
  })
})
