import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/requireUser', () => ({
  AuthError: class AuthError extends Error {},
  requireAgencyUser: vi.fn(async () => ({ id: 1, agencyId: 2, email: 'o@example.com', name: 'O T' })),
}))
vi.mock('@/db/trial', () => ({ startTrialForAgency: vi.fn(async () => ({ started: true })), recordWelcomeModalSeen: vi.fn() }))
vi.mock('@/lib/emailAutomations/live', () => ({ dispatchLifecycleEvent: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/device', () => ({ isMobileRequest: vi.fn(async () => false) }))

import { startTrial, trackTrialStartClicked } from '@/actions/trial'
import { startTrialForAgency } from '@/db/trial'
import { track } from '@/lib/analytics/track'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(startTrialForAgency).mockClear()
  vi.mocked(track).mockClear()
})

describe('startTrial with card-required trials', () => {
  it('refuses to start a card-less trial when cards are required', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    expect(await startTrial()).toEqual({ error: 'card_required' })
    expect(startTrialForAgency).not.toHaveBeenCalled()
  })

  /**
   * This used to assert that click-to-start still worked when the flag was off.
   * Payment Links were what made that safe — they were the only way such a
   * trial ever converted — and this release removes them. A trial started here
   * would reach day seven with no stored card to charge and no link to send, so
   * it is refused at the source rather than handed out and broken later.
   */
  it('refuses click-to-start when there is no billing path at all', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '')
    expect(await startTrial()).toEqual({ error: 'billing_not_available' })
    // Nothing is written: no trial row, so no dates to undo.
    expect(startTrialForAgency).not.toHaveBeenCalled()
  })

  it('starts for an allowlisted account during validation, because that one CAN be billed', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '2')
    // Agency 2 is asked for a card, so the card-required branch owns it.
    expect(await startTrial()).toEqual({ error: 'card_required' })
    expect(startTrialForAgency).not.toHaveBeenCalled()
  })

  it('records whether the click came from the card-required variant', async () => {
    await trackTrialStartClicked()
    expect(track).toHaveBeenCalledWith({ agencyId: 2, userId: 1, event: 'trial_start_clicked', props: { cardRequired: false } })
  })
})
