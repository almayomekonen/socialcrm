import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { startCardSetupForUser } from '@/lib/payments/cardTrial/startCardSetup'
import { getCardSetupStateForAgency } from '@/lib/payments/cardTrial/setupStatus'
import { seedAgency, seedUser, seedMethod, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

/** Grow's createPaymentProcess is a local mock here — no network, not sandbox evidence. */
const createTokenOnlyProcess = vi.fn()
const deps = { createTokenOnlyProcess }

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
  createTokenOnlyProcess.mockReset()
  createTokenOnlyProcess.mockImplementation(async () => ({
    processId: `proc-${Math.random().toString(36).slice(2, 10)}`,
    processToken: 'ptok-plain',
    url: 'https://sandbox.meshulam.co.il/far?l=x',
  }))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

async function owner(role: Roles = Roles.ADMIN, agencyOver: Record<string, unknown> = {}) {
  const agencyId = await seedAgency(agencyOver)
  const id = await seedUser(agencyId, role)
  return { id, agencyId, email: 'owner@example.com', role }
}
const good = { purpose: 'trial_start' as const, fullName: 'John Smith', phone: '050-123-4567', acceptedTerms: true, acceptedCardStorage: true }
const events = (agencyId: number, event: string) => db('analytics_events').where({ agencyId, event })

describe('startCardSetupForUser', () => {
  it('refuses non-admins', async () => {
    expect(await startCardSetupForUser(await owner(Roles.AGNT), good, deps)).toEqual({ error: 'unauthorized' })
  })

  it('refuses a runtime that may not call Grow, and records the funnel failure', async () => {
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', '')
    const r = await owner()
    expect(await startCardSetupForUser(r, good, deps)).toEqual({ error: 'provider_unavailable' })
    expect(createTokenOnlyProcess).not.toHaveBeenCalled()
    const [row] = await events(r.agencyId, 'card_setup_failed')
    expect(row.props).toEqual({ stage: 'create', reason: 'provider_unavailable', purpose: 'trial_start' })
  })

  it('refuses a trial start when cards are not required, and an agency whose trial already started', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    expect(await startCardSetupForUser(await owner(), good, deps)).toEqual({ error: 'not_eligible' })
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    const started = await owner(Roles.ADMIN, { trialStartedAt: hoursFromNow(-1), trialEndsAt: hoursFromNow(100) })
    expect(await startCardSetupForUser(started, good, deps)).toEqual({ error: 'not_eligible' })
  })

  it('refuses without explicit acceptance of the subscription terms', async () => {
    const r = await owner()
    expect(await startCardSetupForUser(r, { ...good, acceptedTerms: false }, deps)).toEqual({ error: 'terms_required' })
    expect(await startCardSetupForUser(r, { purpose: 'trial_start', fullName: 'John Smith', phone: '0501234567', acceptedCardStorage: true }, deps)).toEqual({ error: 'terms_required' })
    expect(createTokenOnlyProcess).not.toHaveBeenCalled()
    expect(await db('billing_payment_methods').where({ agencyId: r.agencyId })).toHaveLength(0)
  })

  it('validates the card holder before calling Grow', async () => {
    const res = await startCardSetupForUser(await owner(), { ...good, phone: '031234567' }, deps)
    expect(res).toMatchObject({ error: 'invalid_holder', field: 'phone' })
    expect(createTokenOnlyProcess).not.toHaveBeenCalled()
  })

  it('creates a pending row with accepted terms, calls Grow with public URLs and returns the payment page', async () => {
    const r = await owner()
    expect(await startCardSetupForUser(r, good, deps)).toEqual({ ok: true, url: 'https://sandbox.meshulam.co.il/far?l=x' })
    const call = createTokenOnlyProcess.mock.calls[0][0]
    expect(call.holder).toEqual({ fullName: 'John Smith', phone: '0501234567', email: 'owner@example.com' })
    expect(call.successUrl).toBe('https://staging.example.com/billing/success?source=card_trial')
    expect(call.cancelUrl).toBe('https://staging.example.com/dashboard')
    expect(call.notifyUrl).toBe('https://staging.example.com/api/payments/grow/notify')
    expect(call.reference).toMatch(/^[0-9a-f]{32}$/)
    const row = await db('billing_payment_methods').where({ agencyId: r.agencyId }).first()
    expect(row).toMatchObject({ status: 'pending', purpose: 'trial_start', reference: call.reference, providerMode: 'sandbox', termsVersion: '2026-09-15' })
    expect(row.termsAcceptedAt).not.toBeNull()
    expect(row.setupProcessToken).not.toBe('ptok-plain')
    expect(await getCardSetupStateForAgency(r.agencyId)).toEqual({ state: 'verifying', callbackReceived: false, firstChargeAt: null })
    expect((await events(r.agencyId, 'card_setup_started').first()).props).toEqual({ purpose: 'trial_start' })
  })

  it('supersedes the previous pending setup when the customer starts again', async () => {
    const r = await owner()
    await startCardSetupForUser(r, good, deps)
    await startCardSetupForUser(r, good, deps)
    const rows = await db('billing_payment_methods').where({ agencyId: r.agencyId }).orderBy('id')
    expect(rows.map((x) => x.status)).toEqual(['invalid', 'pending'])
    expect(rows[0].invalidReason).toBe('superseded_by_newer_setup')
  })

  it('refuses without explicit consent to store the card, for every purpose', async () => {
    const r = await owner()
    expect(await startCardSetupForUser(r, { ...good, acceptedCardStorage: false }, deps)).toEqual({ error: 'card_storage_consent_required' })
    expect(createTokenOnlyProcess).not.toHaveBeenCalled()
    // card_update needs no new subscription terms, but still needs this one.
    const updater = await owner(Roles.ADMIN, { trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(100) })
    await seedMethod(updater.agencyId)
    expect(await startCardSetupForUser(updater, { purpose: 'card_update' }, deps)).toEqual({ error: 'card_storage_consent_required' })
    expect(createTokenOnlyProcess).not.toHaveBeenCalled()
  })

  it('records the card-storage consent with its version', async () => {
    const r = await owner()
    await startCardSetupForUser(r, good, deps)
    const row = await db('billing_payment_methods').where({ agencyId: r.agencyId }).first()
    expect(row.cardStorageConsentVersion).toBe('2026-09-16')
    expect(row.cardStorageConsentAt).not.toBeNull()
  })

  it('replaces a card without new terms, reusing the saved holder', async () => {
    const r = await owner(Roles.ADMIN, { trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(100) })
    await seedMethod(r.agencyId)
    expect(await startCardSetupForUser(r, { purpose: 'card_update', acceptedCardStorage: true }, deps)).toMatchObject({ ok: true })
    const row = await db('billing_payment_methods').where({ agencyId: r.agencyId, status: 'pending' }).first()
    expect(row).toMatchObject({ purpose: 'card_update', termsVersion: null, holderFullName: 'John Smith' })
    expect(createTokenOnlyProcess.mock.calls[0][0].cancelUrl).toBe('https://staging.example.com/settings/update_payment')
  })

  it('marks the row removed and answers provider_unavailable when Grow fails', async () => {
    createTokenOnlyProcess.mockRejectedValue(new Error('boom'))
    const r = await owner()
    expect(await startCardSetupForUser(r, good, deps)).toEqual({ error: 'provider_unavailable' })
    expect(await db('billing_payment_methods').where({ agencyId: r.agencyId }).first()).toMatchObject({ status: 'removed', invalidReason: 'process_create_failed' })
  })
})
