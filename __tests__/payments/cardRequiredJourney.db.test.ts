import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { startTrialInTransaction, getAgencyTrial } from '@/db/trial'
import { welcomeCardStage } from '@/lib/payments/cardTrial/availability'
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
