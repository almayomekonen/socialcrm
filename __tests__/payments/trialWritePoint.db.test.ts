import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { db } from '@/config/db'
import { startTrialForAgency, getAgencyTrial, recordWelcomeModalSeen } from '@/db/trial'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { seedAgency, seedMethod, seedSubscription, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

describe('trial write point', () => {
  it('refuses to start a trial without an active card when cards are required', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    const agencyId = await seedAgency()
    expect(await startTrialForAgency(agencyId)).toEqual({ started: false })
  })

  it('starts the trial when an active card exists', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    const agencyId = await seedAgency()
    await seedMethod(agencyId)
    expect(await startTrialForAgency(agencyId)).toEqual({ started: true })
  })

  it('keeps click-to-start when the flag is off, card or not', async () => {
    const agencyId = await seedAgency()
    expect(await startTrialForAgency(agencyId)).toEqual({ started: true })
    expect(await startTrialForAgency(agencyId)).toEqual({ started: false })
  })
})

describe('conversion grace read', () => {
  async function endedCardTrial(sub: Record<string, unknown> = {}) {
    const endsAt = new Date(Math.floor((Date.now() - 15 * 60_000) / 1000) * 1000)
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-168), trialEndsAt: endsAt })
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId, sub)
    return { agencyId, pm, endsAt }
  }

  it('exposes trialEndsAt + 1h for an uncancelled card trial with no failed charge', async () => {
    const { agencyId, endsAt } = await endedCardTrial()
    const row = await getAgencyTrial(agencyId)
    expect(new Date(row.conversionGraceEndsAt).getTime()).toBe(endsAt.getTime() + 3_600_000)
    expect(await getEffectiveLeadPlan(agencyId)).toBe('pro')
  })

  it('has no grace once the first attempt failed', async () => {
    const { agencyId, pm } = await endedCardTrial()
    await seedCharge(agencyId, pm, { status: 'failed_retryable' })
    expect((await getAgencyTrial(agencyId)).conversionGraceEndsAt).toBeNull()
    expect(await getEffectiveLeadPlan(agencyId)).toBe('free')
  })

  it('has no grace when the customer cancelled, and none for an agency without a card (unchanged behaviour)', async () => {
    const { agencyId } = await endedCardTrial({ cancelAtPeriodEnd: true })
    expect((await getAgencyTrial(agencyId)).conversionGraceEndsAt).toBeNull()
    const noCard = await seedAgency({ trialStartedAt: hoursFromNow(-168), trialEndsAt: hoursFromNow(-0.25) })
    expect((await getAgencyTrial(noCard)).conversionGraceEndsAt).toBeNull()
    expect(await getEffectiveLeadPlan(noCard)).toBe('free')
  })
})

describe('welcome modal funnel event', () => {
  it('records whether the card-required variant was shown', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    const agencyId = await seedAgency()
    await recordWelcomeModalSeen(agencyId, null, 'desktop')
    const row = await db('analytics_events').where({ agencyId, event: 'welcome_modal_shown' }).first()
    expect(row.props).toEqual({ surface: 'desktop', cardRequired: true })
  })
})
