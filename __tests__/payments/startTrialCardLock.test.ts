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

  it('keeps click-to-start when the flag is off', async () => {
    expect(await startTrial()).toEqual({ ok: true, started: true })
    expect(startTrialForAgency).toHaveBeenCalledWith(2, 1)
  })

  it('records whether the click came from the card-required variant', async () => {
    await trackTrialStartClicked()
    expect(track).toHaveBeenCalledWith({ agencyId: 2, userId: 1, event: 'trial_start_clicked', props: { cardRequired: false } })
  })
})
