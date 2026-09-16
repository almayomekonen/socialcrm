import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { encryptSecret } from '@/lib/crypto/secrets'
import { startCardSetupForUser } from '@/lib/payments/cardTrial/startCardSetup'
import { confirmCardSetup, type ConfirmDeps } from '@/lib/payments/cardTrial/confirmCardSetup'
import { getCardSetupStateForAgency } from '@/lib/payments/cardTrial/setupStatus'
import { getCardTrialView, cardReactivationFor } from '@/lib/payments/cardTrial/cardTrialView'
import { runChargePass, type PassDeps } from '@/lib/payments/charges/runChargePass'
import { executeCharge, type ExecuteDeps } from '@/lib/payments/charges/executeCharge'
import { reconcileUnknownCharges } from '@/lib/payments/charges/reconcileUnknown'
import { claimDueCharges } from '@/db/payments/charges'
import { scheduleDueTrialConversions } from '@/db/payments/chargeScheduling'
import { startTrialForAgency } from '@/db/trial'
import { ownersCardTrialChargeSoon } from '@/lib/emailAutomations/recipients'
import type { GrowCallback } from '@/lib/payments/grow/callbackPayload'
import type { TokenChargeResult } from '@/lib/payments/grow/api'
import { GrowTransportError } from '@/lib/payments/grow/http'
import { seedAgency, seedUser, seedMethod, seedSubscription, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

/**
 * THE WHOLE CUSTOMER JOURNEY, END TO END, AGAINST AN EXPLICITLY MOCKED PROVIDER.
 *
 * Every Grow interaction here is a local test double: the token-save
 * verification and the token charge are injected. None of this is evidence that
 * the real Grow integration works — the committed provider-evidence gates stay
 * closed, and these doubles exist only to exercise OUR lifecycle.
 */

const FIXTURE_CARD = {
  cardToken: 'ct-journey',
  cardSuffix: '3253',
  cardBrand: 'Visa',
  cardExp: '1230',
  setupTransactionId: '301770',
  setupTransactionToken: 'tt',
  setupStatusCode: 'FIXTURE-SAVED',
}
const verifiedDeps: ConfirmDeps = { verify: async () => ({ kind: 'verified', card: FIXTURE_CARD }), runtimeMode: () => 'sandbox' }
const charging = (result: TokenChargeResult | Error): ExecuteDeps => ({
  chargeToken: async () => {
    if (result instanceof Error) throw result
    return result
  },
  dispatchAllowed: () => true,
})
const passDeps = (execute: PassDeps['execute']): PassDeps => ({
  execute,
  reconcile: async () => ({ paid: 0, notCharged: 0, undetermined: 0 }),
  dispatchAllowed: () => true,
  clock: () => Date.now(),
})

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'staging')
  vi.stubEnv('GROW_MODE', 'sandbox')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
  vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
  vi.stubEnv('GROW_USER_ID', 'user-1')
  vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'page-1')
  vi.stubEnv('APP_HOST', 'staging.example.com')
  vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
  vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', 'true')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

let processCounter = 0
const createTokenOnlyProcess = async () => {
  processCounter += 1
  return { processId: `proc-journey-${processCounter}`, processToken: `ptok-${processCounter}`, url: 'https://sandbox.meshulam.co.il/far?l=x' }
}

async function signUp() {
  const agencyId = await seedAgency()
  const userId = await seedUser(agencyId)
  return { agencyId, requester: { id: userId, agencyId, email: 'owner@example.com', role: Roles.ADMIN } }
}

async function openSetup(requester: { id: number; agencyId: number; email: string; role: Roles }, purpose: 'trial_start' | 'card_update' | 'reactivate' = 'trial_start') {
  const res = await startCardSetupForUser(requester, { purpose, fullName: 'John Smith', phone: '0501234567', acceptedTerms: true, acceptedCardStorage: true }, { createTokenOnlyProcess })
  if (!('ok' in res)) throw new Error(`fixture: setup refused (${JSON.stringify(res)})`)
  const row = await db('billing_payment_methods').where({ agencyId: requester.agencyId, status: 'pending' }).orderBy('id', 'desc').first()
  return { methodId: Number(row.id), processId: row.setupProcessId as string, reference: row.reference as string }
}

const callbackFor = (setup: { processId: string; reference: string }, index: number): GrowCallback => ({
  processId: setup.processId,
  processToken: `ptok-${index}`,
  transactionId: '301770',
  transactionToken: 'tt',
  statusCode: '11',
  sum: '1',
  cardToken: FIXTURE_CARD.cardToken,
  cardSuffix: '3253',
  cardBrand: 'Visa',
  cardExp: '1230',
  reference: setup.reference,
})
const agencyRow = (id: number) => db('agencies').where({ id }).first()
const charges = (agencyId: number) => db('billing_charges').where({ agencyId }).orderBy('id')

describe('the card-required trial, end to end (mocked provider)', () => {
  it('setup → verified activation → trial → first charge → renewal', async () => {
    const { agencyId, requester } = await signUp()
    const setup = await openSetup(requester)

    // Nothing is granted by opening the page.
    expect((await agencyRow(agencyId)).trialStartedAt).toBeNull()
    expect(await getCardSetupStateForAgency(agencyId)).toMatchObject({ state: 'verifying', callbackReceived: false })

    // The verified callback — and only it — starts the trial.
    expect(await confirmCardSetup(callbackFor(setup, processCounter), verifiedDeps)).toMatchObject({ kind: 'confirmed', trialStarted: true })
    const view = await getCardTrialView(agencyId)
    expect(view).toMatchObject({ setup: 'confirmed', payment: 'none', cancelAtPeriodEnd: false, cardBilled: true })
    expect(view.card).toEqual({ suffix: '3253', brand: 'Visa' })
    const trialEndsAt = new Date((await agencyRow(agencyId)).trialEndsAt)
    expect(view.firstChargeAt?.getTime()).toBe(trialEndsAt.getTime())

    // A duplicate delivery changes nothing.
    expect(await confirmCardSetup(callbackFor(setup, processCounter), verifiedDeps)).toMatchObject({ kind: 'already_processed' })
    expect(new Date((await agencyRow(agencyId)).trialEndsAt).getTime()).toBe(trialEndsAt.getTime())

    // Two days before the charge the reminder audience picks the agency up.
    await db('agencies').where({ id: agencyId }).update({ trialEndsAt: hoursFromNow(48) })
    expect((await ownersCardTrialChargeSoon()).map((r) => r.agencyId)).toContain(agencyId)

    // The trial ends: one scheduled, dispatched, paid charge.
    await db('agencies').where({ id: agencyId }).update({ trialEndsAt: hoursFromNow(-0.2) })
    const summary = await runChargePass(passDeps((chargeId) => executeCharge(chargeId, charging({ kind: 'paid', transactionId: `tx-${agencyId}`, transactionToken: 'tt', asmachta: '1', statusCode: '2' }))))
    expect(summary).toMatchObject({ enabled: true, dispatch: true, scheduled: { conversions: 1 } })
    expect(summary.executed.succeeded).toBe(1)
    expect(await agencyRow(agencyId)).toMatchObject({ plan: 'pro', planReason: `grow:tx-${agencyId}` })
    expect(await db('payments').where({ agencyId }).first()).toBeTruthy()

    // A month later the renewal charges once, on the same card.
    await db('subscriptions').where({ agencyId }).update({ expiresAt: hoursFromNow(0.5) })
    await runChargePass(passDeps((chargeId) => executeCharge(chargeId, charging({ kind: 'paid', transactionId: `tx2-${agencyId}`, transactionToken: null, asmachta: null, statusCode: '2' }))))
    const rows = await charges(agencyId)
    expect(rows.filter((r) => r.kind === 'renewal' && r.status === 'succeeded')).toHaveLength(1)
  })

  it('delayed, duplicate, failed and expired setups never activate anything', async () => {
    const { agencyId, requester } = await signUp()
    const first = await openSetup(requester)
    const firstIndex = processCounter

    // A second attempt supersedes the first: the abandoned page can no longer activate.
    const second = await openSetup(requester)
    expect(await confirmCardSetup(callbackFor(first, firstIndex), verifiedDeps)).toMatchObject({ kind: 'already_processed', status: 'invalid' })
    expect((await agencyRow(agencyId)).trialStartedAt).toBeNull()

    // Verification unavailable (the committed default): recorded, nothing granted.
    const unavailable: ConfirmDeps = { verify: async () => ({ kind: 'unavailable', reason: 'provider_evidence_missing' }), runtimeMode: () => 'sandbox' }
    expect(await confirmCardSetup(callbackFor(second, processCounter), unavailable)).toMatchObject({ kind: 'awaiting_evidence' })
    expect(await getCardSetupStateForAgency(agencyId)).toMatchObject({ state: 'verifying', callbackReceived: true })
    expect((await agencyRow(agencyId)).trialStartedAt).toBeNull()

    // Grow answers, but not with a clean token save: needs review, no trial.
    const refused: ConfirmDeps = { verify: async () => ({ kind: 'refused', reason: 'unexpected_status' }), runtimeMode: () => 'sandbox' }
    expect(await confirmCardSetup(callbackFor(second, processCounter), refused)).toMatchObject({ kind: 'refused', reason: 'unexpected_status' })
    expect(await getCardSetupStateForAgency(agencyId)).toMatchObject({ state: 'failed' })
    expect((await agencyRow(agencyId)).trialStartedAt).toBeNull()
  })

  it('cancelling before verification, and while a charge is already dispatched', async () => {
    // Before verification: the pending setup is invalidated, so a late callback cannot revive it.
    const early = await signUp()
    const setup = await openSetup(early.requester)
    await seedSubscription(early.agencyId, { cancelAtPeriodEnd: true })
    await db('billing_payment_methods').where({ id: setup.methodId }).update({ status: 'invalid', invalidReason: 'superseded_by_cancellation' })
    expect(await confirmCardSetup(callbackFor(setup, processCounter), verifiedDeps)).toMatchObject({ kind: 'already_processed' })
    expect((await agencyRow(early.agencyId)).trialStartedAt).toBeNull()

    // While dispatched: the charge completes, the paid period stands, the cancellation survives.
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-0.2) })
    await seedMethod(agencyId)
    await seedSubscription(agencyId)
    await scheduleDueTrialConversions(50)
    const [claimed] = await claimDueCharges('journey', 1, agencyId)
    // The customer cancels while the request is with Grow: the charge is already
    // dispatched, so it completes and the cancellation must survive it.
    const cancelsMidFlight: ExecuteDeps = {
      dispatchAllowed: () => true,
      chargeToken: async () => {
        await db('subscriptions').where({ agencyId }).update({ cancelAtPeriodEnd: true })
        return { kind: 'paid', transactionId: `tx-late-${agencyId}`, transactionToken: null, asmachta: null, statusCode: '2' }
      },
    }
    expect(await executeCharge(claimed.id, cancelsMidFlight)).toBe('succeeded')
    expect(await db('subscriptions').where({ agencyId }).first()).toMatchObject({ cancelAtPeriodEnd: true })
    expect((await agencyRow(agencyId)).plan).toBe('pro')
  })

  it('a decline locks the card and offers reactivation; an unknown outcome stays unknown', async () => {
    const declined = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-0.2) })
    const pm = await seedMethod(declined)
    await seedSubscription(declined)
    await runChargePass(passDeps((id) => executeCharge(id, charging({ kind: 'grow_error', errorId: 103, errorMessage: 'כרטיס גנוב - עסקה לא מאושרת' }))))
    expect((await db('billing_payment_methods').where({ id: pm }).first()).status).toBe('invalid')
    expect(await cardReactivationFor(declined)).toEqual({ reason: 'declined' })

    const unknown = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-0.2) })
    await seedMethod(unknown)
    await seedSubscription(unknown)
    await runChargePass(passDeps((id) => executeCharge(id, charging(new GrowTransportError('timeout')))))
    expect((await charges(unknown))[0]).toMatchObject({ status: 'unknown', errorClass: 'transport_timeout' })
    expect(await reconcileUnknownCharges(10)).toMatchObject({ paid: 0, notCharged: 0, undetermined: 1 })
    expect(await charges(unknown)).toHaveLength(1)
  })

  it('replacing a card does not reactivate a cancelled subscription', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-30) })
    const userId = await seedUser(agencyId)
    await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true })
    const setup = await openSetup({ id: userId, agencyId, email: 'o@example.com', role: Roles.ADMIN }, 'card_update')
    expect(await confirmCardSetup(callbackFor(setup, processCounter), verifiedDeps)).toMatchObject({ kind: 'confirmed', purpose: 'card_update' })
    expect(await db('subscriptions').where({ agencyId }).first()).toMatchObject({ cancelAtPeriodEnd: true })
    expect(await charges(agencyId)).toHaveLength(0)
  })

  it('existing no-card and legacy agencies are untouched', async () => {
    // Card required: a trial cannot start without a card.
    const noCard = await seedAgency()
    expect(await startTrialForAgency(noCard)).toEqual({ started: false })

    // Flag off: click-to-start works exactly as before.
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    const clickToStart = await seedAgency()
    expect(await startTrialForAgency(clickToStart)).toEqual({ started: true })
    expect(await getCardTrialView(clickToStart)).toMatchObject({ cardBilled: false, setup: 'none', payment: 'none' })
    expect(await cardReactivationFor(clickToStart)).toBeUndefined()

    // Legacy (trialExempt) agencies are never scheduled for a token charge.
    const legacy = await seedAgency({ trialExempt: true, trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-2) })
    await seedMethod(legacy)
    await seedSubscription(legacy)
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    await runChargePass(passDeps(async () => 'skipped'))
    expect(await charges(legacy)).toHaveLength(0)
  })

  it('a pending setup for a cancelled subscription cannot be confirmed into a reactivation', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-30) })
    const userId = await seedUser(agencyId)
    await seedMethod(agencyId, { status: 'invalid' })
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true })
    const processId = `proc-stale-${agencyId}`
    await seedMethod(agencyId, {
      status: 'pending', purpose: 'reactivate', cardToken: null, confirmedAt: null, createdByUserId: userId,
      setupProcessId: processId, setupProcessToken: encryptSecret('ptok-stale'), reference: `ref-stale-${agencyId}`,
    })
    await db('billing_payment_methods').where({ setupProcessId: processId }).update({ status: 'invalid', invalidReason: 'superseded_by_cancellation' })
    const callback = { ...callbackFor({ processId, reference: `ref-stale-${agencyId}` }, 0), processToken: 'ptok-stale' }
    expect(await confirmCardSetup(callback, verifiedDeps)).toMatchObject({ kind: 'already_processed', status: 'invalid' })
    expect(await db('subscriptions').where({ agencyId }).first()).toMatchObject({ cancelAtPeriodEnd: true })
  })
})
