import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { db } from '@/config/db'
import { hasBillingPath } from '@/lib/payments/cardTrial/availability'

/**
 * NEVER OPEN A TRIAL WE CANNOT BILL.
 *
 * Payment Links were the only way a click-to-start trial ever converted, and
 * this release removes them. A trial opened outside the card-required flow
 * would therefore reach day seven with no stored card to charge and no link to
 * send — the customer loses access having been told they were on a trial.
 *
 * During the production validation window that set is the allowlisted owner
 * and nobody else; after global activation it is everyone. The rule is pinned
 * here so the validation window cannot quietly hand out unbillable trials.
 */

afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  await db.destroy()
})

describe('hasBillingPath', () => {
  it('is false for everyone while the card flow is off — no unbillable trials', () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '')
    expect(hasBillingPath(6)).toBe(false)
    expect(hasBillingPath(999)).toBe(false)
  })

  it('is true only for the allowlisted account during validation', () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '6')
    expect(hasBillingPath(6)).toBe(true)
    // Everyone else still has no way to be billed, so no trial for them.
    expect(hasBillingPath(7)).toBe(false)
  })

  it('is true for everyone once the card flow is global', () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '')
    expect(hasBillingPath(6)).toBe(true)
    expect(hasBillingPath(999)).toBe(true)
  })

  it('an empty or malformed allowlist is never read as "everyone"', () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    for (const list of ['', ' ', ',', 'all', '*', 'abc']) {
      vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', list)
      expect(hasBillingPath(6)).toBe(false)
    }
  })
})
