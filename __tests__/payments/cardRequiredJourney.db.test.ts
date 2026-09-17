import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { startTrialInTransaction, getAgencyTrial } from '@/db/trial'
import { welcomeCardStage } from '@/lib/payments/cardTrial/availability'
import { isCardSetupEligible } from '@/lib/payments/cardTrial/startCardSetup'
import { confirmCardSetup } from '@/lib/payments/cardTrial/confirmCardSetup'
import { encryptSecret } from '@/lib/crypto/secrets'
import { seedUser } from './helpers/billingFixtures'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { seedAgency, seedMethod, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

/**
 * (The `card_required` refusal of the click-to-start action is pinned in
 * startTrialCardLock.test.ts, which mocks the request scope a server action
 * needs.)
 *
 * The owner's journey, pinned:
 *
 *   register → accept the disclosure and save a card → verify it
 *   server-to-server → ONLY THEN 7 free days and CRM access → ₪89 at the end.
 *
 * What this file exists to stop: an account reaching the product, or a trial
 * clock starting, from anything other than a verified card. And a second trial
 * ever being granted — by a repeated callback, a replaced card, or a
 * cancellation followed by a resume.
 */

beforeEach(() => {
  vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

const trialOf = (agencyId: number) => getAgencyTrial(agencyId)

describe('registration alone activates nothing', () => {
  it('a fresh agency has no trial and no CRM access', async () => {
    const agencyId = await seedAgency()
    expect((await trialOf(agencyId))?.trialStartedAt).toBeFalsy()
    expect(await getAgencyProductAccess(agencyId)).toMatchObject({ status: 'NEVER_STARTED', hasAccess: false })
  })

  it('the trial clock refuses to start without an active card', async () => {
    const agencyId = await seedAgency()
    expect(await startTrialInTransaction(db, agencyId)).toBe(false)
    expect((await trialOf(agencyId))?.trialStartedAt).toBeFalsy()
  })

  it('starts only once an ACTIVE card exists', async () => {
    const agencyId = await seedAgency()
    await seedMethod(agencyId) // confirmed + active
    expect(await startTrialInTransaction(db, agencyId)).toBe(true)
    expect((await trialOf(agencyId))?.trialStartedAt).toBeTruthy()
  })
})

describe('no second trial, and no second clock', () => {
  it('a repeated callback cannot restart or extend the trial', async () => {
    const agencyId = await seedAgency()
    await seedMethod(agencyId)
    expect(await startTrialInTransaction(db, agencyId)).toBe(true)
    const first = (await trialOf(agencyId))!.trialEndsAt

    // Grow resends an unacknowledged update; the same confirmation runs again.
    expect(await startTrialInTransaction(db, agencyId)).toBe(false)
    expect(await startTrialInTransaction(db, agencyId)).toBe(false)
    expect((await trialOf(agencyId))!.trialEndsAt).toEqual(first)
  })

  it('replacing the card does not grant another trial', async () => {
    const agencyId = await seedAgency()
    await seedMethod(agencyId)
    await startTrialInTransaction(db, agencyId)
    const ends = (await trialOf(agencyId))!.trialEndsAt

    await db('billing_payment_methods').where({ agencyId }).update({ status: 'replaced' })
    await seedMethod(agencyId, { purpose: 'card_update' })
    expect(await startTrialInTransaction(db, agencyId)).toBe(false)
    expect((await trialOf(agencyId))!.trialEndsAt).toEqual(ends)
  })

  it('an expired trial is never restarted by saving a new card', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-30) })
    await seedMethod(agencyId)
    expect(await startTrialInTransaction(db, agencyId)).toBe(false)
    expect((await trialOf(agencyId))!.trialEndsAt.getTime()).toBeLessThan(Date.now())
  })
})

describe('the first activation: the clock is created BY the verified card, not before it', () => {
  /**
   * The ordering the product promises, pinned end to end. It is NOT enough that
   * "exactly one trial exists" — a trial that already existed and a card added
   * later satisfies that and violates the requirement. This asserts the clock
   * did not exist before the verified confirmation and does exist after it.
   */
  const verified = (cardToken: string) =>
    async () => ({
      kind: 'verified' as const,
      card: { cardToken, cardSuffix: '4580', cardBrand: 'Visa', cardExp: '1230', setupTransactionId: 'tx1', setupTransactionToken: 'tt1', setupStatusCode: '11' },
    })

  async function pendingSetup() {
    const agencyId = await seedAgency()
    const userId = await seedUser(agencyId)
    const methodId = await seedMethod(agencyId, {
      status: 'pending', cardToken: null, confirmedAt: null, cardSuffix: null, cardBrand: null,
      createdByUserId: userId, setupProcessId: `proc-${agencyId}`, setupProcessToken: encryptSecret('ptok'),
    })
    return { agencyId, methodId, processId: `proc-${agencyId}` }
  }
  const callback = (processId: string) => ({
    processId, processToken: 'ptok', cardToken: 'ct-first', reference: null,
    transactionId: null, transactionToken: null, statusCode: null, sum: null, cardSuffix: null, cardBrand: null, cardExp: null,
  })

  it('no trial before, exactly one trial after, and it starts at verification', async () => {
    const s = await pendingSetup()
    expect((await trialOf(s.agencyId))?.trialStartedAt).toBeFalsy()

    const before = Date.now()
    const out = await confirmCardSetup(callback(s.processId), { verify: verified('ct-first'), runtimeMode: () => 'sandbox' })
    expect(out).toMatchObject({ kind: 'confirmed', trialStarted: true })

    const row = (await trialOf(s.agencyId))!
    expect(row.trialStartedAt).toBeTruthy()
    // The clock begins at the verification, not at some earlier moment.
    expect(new Date(row.trialStartedAt).getTime()).toBeGreaterThanOrEqual(before - 5000)
    const days = (new Date(row.trialEndsAt).getTime() - new Date(row.trialStartedAt).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(7)
  })

  it("retains GROW's transactionId for the token save — not our ids, not the processId", async () => {
    // Grow needs its own transactionId to trace either side of the integration.
    // processId identifies the hosted page, and our row id is ours; neither is a
    // substitute, so the save must persist what Grow returned.
    const s = await pendingSetup()
    await confirmCardSetup(callback(s.processId), { verify: verified('ct-first'), runtimeMode: () => 'sandbox' })
    const card = await db('billing_payment_methods').where({ id: s.methodId }).first()
    expect(card.setupTransactionId).toBe('tx1')
    expect(card.setupTransactionToken).toBeTruthy()
    expect(card.setupStatusCode).toBe('11')
  })

  it('a duplicate callback and a recovery both leave that one clock exactly where it was', async () => {
    const s = await pendingSetup()
    await confirmCardSetup(callback(s.processId), { verify: verified('ct-first'), runtimeMode: () => 'sandbox' })
    const first = (await trialOf(s.agencyId))!

    // Grow resends; and the recovery path re-confirms the same process.
    const again = await confirmCardSetup(callback(s.processId), { verify: verified('ct-first'), runtimeMode: () => 'sandbox' })
    expect(again).toMatchObject({ kind: 'already_processed' })

    const after = (await trialOf(s.agencyId))!
    expect(after.trialStartedAt).toEqual(first.trialStartedAt)
    expect(after.trialEndsAt).toEqual(first.trialEndsAt)
    const cards = await db('billing_payment_methods').where({ agencyId: s.agencyId, status: 'active' })
    expect(cards).toHaveLength(1)
  })
})

describe('a trial that began before a card was required', () => {
  /**
   * The owner hit this on staging: a click-to-start trial, no card, and with
   * Payment Links gone there was no way left to pay. Saving a card must be
   * possible — and must not touch the clock they already have.
   */
  it('may save a card mid-trial, and the clock does not move', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(144) })
    const before = (await trialOf(agencyId))!.trialEndsAt
    expect(await isCardSetupEligible(agencyId, 'trial_start')).toBe(true)

    // Confirming that setup cannot restart or extend the trial.
    expect(await startTrialInTransaction(db, agencyId)).toBe(false)
    expect((await trialOf(agencyId))!.trialEndsAt).toEqual(before)
  })

  it('is not offered once a card is already active', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(144) })
    await seedMethod(agencyId)
    expect(await isCardSetupEligible(agencyId, 'trial_start')).toBe(false)
  })

  it('is not offered once the trial has expired — that is reactivation', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-30) })
    expect(await isCardSetupEligible(agencyId, 'trial_start')).toBe(false)
  })
})

describe('what an unactivated account is shown', () => {
  it('offers the form only when no card is saved and a setup can complete', async () => {
    const agencyId = await seedAgency()
    vi.stubEnv('APP_ENV', 'staging')
    vi.stubEnv('GROW_MODE', 'sandbox')
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
    vi.stubEnv('GROW_USER_ID', 'u')
    vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'p')
    vi.stubEnv('APP_HOST', 'staging.example.com')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(await welcomeCardStage(agencyId)).toBe('setup')
  })

  it('says the card is being verified rather than offering the form again', async () => {
    const agencyId = await seedAgency()
    await seedMethod(agencyId, { status: 'pending', cardToken: null, confirmedAt: null, setupProcessId: `p-${agencyId}` })
    expect(await welcomeCardStage(agencyId)).toBe('awaiting')
  })

  it('never strands a new registration behind a form that cannot complete', async () => {
    const agencyId = await seedAgency()
    vi.stubEnv('GROW_USER_ID', '') // provider not configured
    expect(await welcomeCardStage(agencyId)).toBe('unavailable')
  })
})
