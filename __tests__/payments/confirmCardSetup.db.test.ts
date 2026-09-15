import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'
import { confirmCardSetup, type ConfirmDeps } from '@/lib/payments/cardTrial/confirmCardSetup'
import { verifyTokenSaveWithGrow, type TokenSaveVerification } from '@/lib/payments/cardTrial/verifyTokenSave'
import type { GrowCallback } from '@/lib/payments/grow/callbackPayload'
import { seedAgency, seedMethod, seedSubscription, seedUser, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

beforeEach(() => vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true'))
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

/** LOCAL TEST DOUBLE — NOT SANDBOX EVIDENCE. Stands in for a Grow verification result. */
const FIXTURE_VERIFIED: TokenSaveVerification = {
  kind: 'verified',
  card: { cardToken: 'ct-new', cardSuffix: '3253', cardBrand: 'Visa', cardExp: '1230', setupTransactionId: '301770', setupTransactionToken: 'tt', setupStatusCode: 'FIXTURE-SAVED' },
}
const deps = (result: TokenSaveVerification = FIXTURE_VERIFIED): ConfirmDeps & { verify: ReturnType<typeof vi.fn> } => ({
  verify: vi.fn(async () => result),
  runtimeMode: () => 'sandbox',
})

async function pendingSetup(opts: { purpose?: string; agencyId?: number; providerMode?: string } = {}) {
  const agencyId = opts.agencyId ?? (await seedAgency())
  const userId = await seedUser(agencyId)
  const processId = `proc-${agencyId}-${Math.random().toString(36).slice(2, 8)}`
  const processToken = `ptok-${processId}`
  const reference = `ref-${processId}`
  const methodId = await seedMethod(agencyId, {
    status: 'pending', purpose: opts.purpose ?? 'trial_start', providerMode: opts.providerMode ?? 'sandbox',
    cardToken: null, confirmedAt: null, cardSuffix: null, cardBrand: null, cardExp: null,
    termsVersion: opts.purpose === 'card_update' ? null : 'test', termsAcceptedAt: opts.purpose === 'card_update' ? null : new Date(),
    setupProcessId: processId, setupProcessToken: encryptSecret(processToken), createdByUserId: userId, reference,
  })
  return { agencyId, userId, methodId, processId, processToken, reference }
}

const cb = (s: { processId: string; processToken: string; reference: string }, over: Partial<GrowCallback> = {}): GrowCallback => ({
  processId: s.processId, processToken: s.processToken, transactionId: '301770', transactionToken: 'tt', statusCode: '11', sum: '1',
  cardToken: 'ct-new', cardSuffix: '3253', cardBrand: 'Visa', cardExp: '1230', reference: s.reference, ...over,
})
const methodRow = (id: number) => db('billing_payment_methods').where({ id }).first()
const agencyRow = (id: number) => db('agencies').where({ id }).first()

describe('confirmCardSetup — fail closed by default', () => {
  it('with the real verifier and no sandbox evidence: records the callback, activates nothing, starts no trial', async () => {
    const s = await pendingSetup()
    expect(await confirmCardSetup(cb(s), { verify: verifyTokenSaveWithGrow, runtimeMode: () => 'sandbox' })).toEqual({ kind: 'awaiting_evidence', agencyId: s.agencyId })
    expect(await methodRow(s.methodId)).toMatchObject({ status: 'pending', lastVerificationError: 'provider_evidence_missing', cardToken: null })
    expect((await agencyRow(s.agencyId)).trialStartedAt).toBeNull()
  })
})

describe('confirmCardSetup — trial start', () => {
  it('activates the verified card and starts the trial in one transaction', async () => {
    const s = await pendingSetup()
    const d = deps()
    expect(await confirmCardSetup(cb(s), d)).toEqual({ kind: 'confirmed', agencyId: s.agencyId, purpose: 'trial_start', createdByUserId: s.userId, trialStarted: true })
    expect(d.verify).toHaveBeenCalledWith({ processId: s.processId, processToken: s.processToken, cardToken: 'ct-new' })
    const method = await methodRow(s.methodId)
    expect(method.status).toBe('active')
    expect(decryptSecret(method.cardToken)).toBe('ct-new')
    expect((await agencyRow(s.agencyId)).trialStartedAt).not.toBeNull()
    expect(await db('subscriptions').where({ agencyId: s.agencyId }).first()).toMatchObject({ cancelAtPeriodEnd: false, billingPeriod: 'monthly' })
  })

  it('treats repeated and concurrent callbacks as one confirmation, without moving the trial clock', async () => {
    const s = await pendingSetup()
    const outcomes = await Promise.all([confirmCardSetup(cb(s), deps()), confirmCardSetup(cb(s), deps())])
    expect(outcomes.filter((o) => o.kind === 'confirmed')).toHaveLength(1)
    const started = (await agencyRow(s.agencyId)).trialStartedAt
    const late = deps()
    expect(await confirmCardSetup(cb(s), late)).toEqual({ kind: 'already_processed', agencyId: s.agencyId, status: 'active' })
    expect(late.verify).not.toHaveBeenCalled()
    expect((await agencyRow(s.agencyId)).trialStartedAt).toEqual(started)
  })

  it.each([
    ['a wrong process token', { processToken: 'forged' }, 401, 'process_token_mismatch'],
    ['an unknown process', { processId: 'nope' }, 401, 'unknown_process'],
    ['a different reference', { reference: 'someone-else' }, 401, 'reference_mismatch'],
    ['a missing card token', { cardToken: null }, 400, 'missing_fields'],
  ])('rejects %s without touching the row or calling the verifier', async (_label, over, httpStatus, reason) => {
    const s = await pendingSetup()
    const d = deps()
    expect(await confirmCardSetup(cb(s, over as Partial<GrowCallback>), d)).toEqual({ kind: 'rejected', httpStatus, reason })
    expect(d.verify).not.toHaveBeenCalled()
    expect((await methodRow(s.methodId)).status).toBe('pending')
  })

  it('rejects a callback whose Grow mode differs from the setup', async () => {
    const s = await pendingSetup({ providerMode: 'production' })
    expect(await confirmCardSetup(cb(s), deps())).toEqual({ kind: 'rejected', httpStatus: 401, reason: 'mode_mismatch' })
  })

  it('sends a setup to review when Grow does not confirm a clean token save, and starts no trial', async () => {
    const s = await pendingSetup()
    expect(await confirmCardSetup(cb(s), deps({ kind: 'refused', reason: 'unexpected_status' }))).toEqual({ kind: 'refused', agencyId: s.agencyId, reason: 'unexpected_status' })
    expect(await methodRow(s.methodId)).toMatchObject({ status: 'needs_review', invalidReason: 'unexpected_status' })
    expect((await agencyRow(s.agencyId)).trialStartedAt).toBeNull()
  })

  it('asks for a retry when Grow cannot be reached, leaving the setup pending', async () => {
    const s = await pendingSetup()
    expect(await confirmCardSetup(cb(s), deps({ kind: 'unavailable', reason: 'transport_error' }))).toEqual({ kind: 'retry_later', agencyId: s.agencyId, reason: 'transport_error' })
    expect((await methodRow(s.methodId)).status).toBe('pending')
  })

  it('refuses a setup whose creator no longer belongs to the agency', async () => {
    const s = await pendingSetup()
    const other = await seedAgency()
    await db('users').where({ id: s.userId }).update({ agencyId: other })
    expect(await confirmCardSetup(cb(s), deps())).toEqual({ kind: 'refused', agencyId: s.agencyId, reason: 'setup_owner_changed' })
  })

  it('ignores a superseded setup: no card, no trial', async () => {
    const s = await pendingSetup()
    await db('billing_payment_methods').where({ id: s.methodId }).update({ status: 'invalid', invalidReason: 'superseded_by_newer_setup' })
    expect(await confirmCardSetup(cb(s), deps())).toEqual({ kind: 'already_processed', agencyId: s.agencyId, status: 'invalid' })
    expect((await agencyRow(s.agencyId)).trialStartedAt).toBeNull()
  })

  it('never revives a cancelled subscription or restarts the trial when a second trial-start card confirms late', async () => {
    const first = await pendingSetup()
    await confirmCardSetup(cb(first), deps())
    await db('subscriptions').where({ agencyId: first.agencyId }).update({ cancelAtPeriodEnd: true })
    const started = (await agencyRow(first.agencyId)).trialStartedAt
    const second = await pendingSetup({ agencyId: first.agencyId })
    const out = await confirmCardSetup(cb(second), deps())
    expect(out).toMatchObject({ kind: 'confirmed', trialStarted: false })
    expect((await db('subscriptions').where({ agencyId: first.agencyId }).first()).cancelAtPeriodEnd).toBe(true)
    expect((await agencyRow(first.agencyId)).trialStartedAt).toEqual(started)
  })
})

describe('confirmCardSetup — card update and reactivation', () => {
  it('a card update while cancelled keeps the cancellation and schedules no charge', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-30) })
    const oldPm = await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true })
    await seedCharge(agencyId, oldPm, { status: 'failed_final' })
    const s = await pendingSetup({ purpose: 'card_update', agencyId })
    expect(await confirmCardSetup(cb(s), deps())).toMatchObject({ kind: 'confirmed', purpose: 'card_update' })
    expect((await db('subscriptions').where({ agencyId }).first()).cancelAtPeriodEnd).toBe(true)
    expect(await db('billing_charges').where({ agencyId, attempt: 2 }).first()).toBeUndefined()
  })

  it('a reactivation started after the cancellation clears it and schedules an immediate attempt on the new card', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-30) })
    const oldPm = await seedMethod(agencyId, { status: 'invalid' })
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true })
    await seedCharge(agencyId, oldPm, { status: 'failed_final' })
    const s = await pendingSetup({ purpose: 'reactivate', agencyId })
    expect(await confirmCardSetup(cb(s), deps())).toMatchObject({ kind: 'confirmed', purpose: 'reactivate', trialStarted: false })
    expect((await db('subscriptions').where({ agencyId }).first()).cancelAtPeriodEnd).toBe(false)
    const next = await db('billing_charges').where({ agencyId, attempt: 2 }).first()
    expect(next).toMatchObject({ status: 'pending', dispatchedAt: null })
    expect(Number(next.paymentMethodId)).toBe(s.methodId)
  })
})
