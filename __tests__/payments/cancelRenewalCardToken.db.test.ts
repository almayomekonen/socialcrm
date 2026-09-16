import { vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  return { ...actual, requireAgencyUser: vi.fn() }
})
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: vi.fn(async () => ({ enqueued: true })) }))

import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { db } from '@/config/db'
import { requireAgencyUser } from '@/lib/requireUser'
import { notifyEvent } from '@/lib/notifications/emit'
import { Roles } from '@/types/roles'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'
import { encryptSecret } from '@/lib/crypto/secrets'
import { claimDueCharges } from '@/db/payments/charges'
import { beginChargeAttempt } from '@/db/payments/chargeDispatch'
import { scheduleDueTrialConversions } from '@/db/payments/chargeScheduling'
import { renewalPeriodKey } from '@/db/payments/periodKeys'
import { confirmCardSetup } from '@/lib/payments/cardTrial/confirmCardSetup'
import { seedAgency, seedMethod, seedSubscription, seedUser, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

afterEach(async () => {
  vi.mocked(notifyEvent).mockClear()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

async function signedIn(agency: Record<string, unknown>) {
  const agencyId = await seedAgency(agency)
  const id = await seedUser(agencyId)
  vi.mocked(requireAgencyUser).mockResolvedValue({ id, agencyId, role: Roles.ADMIN, email: 'o@example.com' } as never)
  return { agencyId, userId: id }
}
const activeTrial = { trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(120) }
const endedTrial = { trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-2) }
const event = (agencyId: number, name: string) => db('analytics_events').where({ agencyId, event: name })
const sub = (agencyId: number) => db('subscriptions').where({ agencyId }).first()

describe('cancelRenewal — card-token billing', () => {
  it('cancels a card trial before any charge: nothing to stop at Grow, one analytics event', async () => {
    const { agencyId } = await signedIn(activeTrial)
    await seedMethod(agencyId)
    await seedSubscription(agencyId)
    expect(await cancelRenewal()).toEqual({ ok: true })
    expect((await sub(agencyId)).cancelAtPeriodEnd).toBe(true)
    expect(notifyEvent).not.toHaveBeenCalled()
    expect(await cancelRenewal()).toEqual({ ok: true })
    const rows = await event(agencyId, 'subscription_cancel_requested')
    expect(rows.map((r) => r.props)).toEqual([{ billing: 'card_token', chargeInProgress: false }])
  })

  it('stops every undispatched charge and invalidates open card setups', async () => {
    const { agencyId } = await signedIn(endedTrial)
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId)
    const pending = await seedCharge(agencyId, pm, { status: 'pending' })
    const claimed = await seedCharge(agencyId, pm, { periodKey: 'renewal:x', status: 'in_flight', lockedAt: new Date() })
    const setup = await seedMethod(agencyId, { status: 'pending', purpose: 'reactivate', cardToken: null, confirmedAt: null })
    expect(await cancelRenewal()).toEqual({ ok: true })
    const statuses = await db('billing_charges').whereIn('id', [pending, claimed]).orderBy('id').pluck('status')
    expect(statuses).toEqual(['cancelled', 'cancelled'])
    expect(await db('billing_payment_methods').where({ id: setup }).first()).toMatchObject({ status: 'invalid', invalidReason: 'superseded_by_cancellation' })
  })

  it('a charge already dispatched to Grow is reported honestly and left to settle', async () => {
    const { agencyId } = await signedIn(endedTrial)
    await seedMethod(agencyId)
    await seedSubscription(agencyId)
    await scheduleDueTrialConversions(50)
    const [claimed] = await claimDueCharges('w', 1, agencyId)
    expect(await beginChargeAttempt(claimed.id)).not.toBeNull()
    expect(await cancelRenewal()).toEqual({ ok: true, chargeInProgress: true })
    expect((await db('billing_charges').where({ id: claimed.id }).first()).status).toBe('in_flight')
    expect((await event(agencyId, 'subscription_cancel_requested').first()).props).toEqual({ billing: 'card_token', chargeInProgress: true })
  })

  it('a reactivation page opened before the cancellation cannot undo it when its callback arrives', async () => {
    const { agencyId, userId } = await signedIn(endedTrial)
    await seedMethod(agencyId, { status: 'invalid' })
    await seedSubscription(agencyId)
    const processId = `proc-${agencyId}`
    await seedMethod(agencyId, {
      status: 'pending', purpose: 'reactivate', cardToken: null, confirmedAt: null, createdByUserId: userId,
      setupProcessId: processId, setupProcessToken: encryptSecret('ptok'), reference: `ref-${agencyId}`,
    })
    await cancelRenewal()
    /** LOCAL TEST DOUBLE — not sandbox evidence. */
    const verify = vi.fn(async () => ({ kind: 'verified' as const, card: { cardToken: 'ct', cardSuffix: null, cardBrand: null, cardExp: null, setupTransactionId: null, setupTransactionToken: null, setupStatusCode: 'FIXTURE' } }))
    const callback = { processId, processToken: 'ptok', cardToken: 'ct', reference: `ref-${agencyId}`, transactionId: null, transactionToken: null, statusCode: null, sum: null, cardSuffix: null, cardBrand: null, cardExp: null }
    expect(await confirmCardSetup(callback, { verify, runtimeMode: () => 'sandbox' })).toMatchObject({ kind: 'already_processed', status: 'invalid' })
    expect((await sub(agencyId)).cancelAtPeriodEnd).toBe(true)
  })

  it('a Payment-Link subscriber still raises the operator task', async () => {
    const { agencyId } = await signedIn(activeTrial)
    await seedSubscription(agencyId)
    expect(await cancelRenewal()).toEqual({ ok: true })
    expect((await event(agencyId, 'subscription_cancel_requested').first()).props).toEqual({ billing: 'payment_link', chargeInProgress: false })
  })
})

describe('resumeRenewal — card-token billing', () => {
  it('resumes a card trial that still has access and records it once', async () => {
    const { agencyId } = await signedIn(activeTrial)
    await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true })
    expect(await resumeRenewal()).toEqual({ ok: true })
    expect(await resumeRenewal()).toEqual({ ok: true })
    expect((await sub(agencyId)).cancelAtPeriodEnd).toBe(false)
    expect((await event(agencyId, 'subscription_resumed')).map((r) => r.props)).toEqual([{ billing: 'card_token' }])
  })

  it('reopens the current renewal period the cancellation stopped, and never a historical one', async () => {
    const expiresAt = new Date(Math.floor((Date.now() + 30 * 60_000) / 1000) * 1000)
    const { agencyId } = await signedIn({ plan: 'pro', planReason: 'grow:1', trialStartedAt: hoursFromNow(-900), trialEndsAt: hoursFromNow(-730) })
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true, expiresAt })
    await seedCharge(agencyId, pm, { kind: 'renewal', periodKey: 'renewal:2026-02-01T00:00:00Z', status: 'cancelled', errorClass: 'cancelled_by_customer' })
    await seedCharge(agencyId, pm, { kind: 'renewal', periodKey: renewalPeriodKey(expiresAt), status: 'cancelled', errorClass: 'cancelled_by_customer' })
    expect(await resumeRenewal()).toEqual({ ok: true })
    expect(await db('billing_charges').where({ agencyId, periodKey: renewalPeriodKey(expiresAt), attempt: 2 }).first()).toMatchObject({ status: 'pending' })
    expect(await db('billing_charges').where({ agencyId, periodKey: 'renewal:2026-02-01T00:00:00Z' })).toHaveLength(1)
  })

  it('refuses a silent immediate charge: a card subscription whose access ended must reactivate', async () => {
    const { agencyId } = await signedIn(endedTrial)
    await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true })
    expect(await resumeRenewal()).toEqual({ error: 'reactivation_required' })
    expect((await sub(agencyId)).cancelAtPeriodEnd).toBe(true)
  })
})
