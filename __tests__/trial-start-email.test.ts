/**
 * actions/trial.startTrial — now a pair of refusals, not a trial starter.
 *
 * Fully mocked / DB-free (VITEST_NO_DB-safe): the DB transition, the email
 * dispatcher, and next/{cache,server} are all stubbed. Proves the wiring
 * contract: fire exactly once on the real transition, never otherwise, to the
 * authenticated activator, and never let email delivery fail or roll back the
 * trial.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// after() runs its callback (post-response). We invoke it and swallow any
// rejection, exactly like the platform: an error in after() never fails the
// action's response.
vi.mock('next/server', () => ({
  after: vi.fn((cb: () => unknown) => {
    try {
      const r = cb()
      if (r && typeof (r as any).then === 'function') (r as Promise<unknown>).catch(() => {})
    } catch {
      /* swallowed — mirrors platform behavior */
    }
  }),
}))
vi.mock('@/db/trial', () => ({ startTrialForAgency: vi.fn(), recordWelcomeModalSeen: vi.fn() }))
vi.mock('@/lib/emailAutomations/live', () => ({ dispatchLifecycleEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/requireUser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  return { ...actual, requireAgencyUser: vi.fn() }
})

import { startTrial } from '@/actions/trial'
import { startTrialForAgency } from '@/db/trial'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'

const ACTIVATOR = { id: 7, agencyId: 3, email: 'activator@example.com', name: 'דוד לוי' } as any

beforeEach(() => {
  vi.mocked(requireAgencyUser).mockReset()
  vi.mocked(startTrialForAgency).mockReset()
  vi.mocked(dispatchLifecycleEvent).mockReset()
  vi.mocked(dispatchLifecycleEvent).mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllEnvs())

/*
 * WHAT CHANGED, AND WHY THESE TESTS DID.
 *
 * These three cases asserted the click-to-start trial and its trial.started
 * email. Two guards since closed that path from both sides:
 *
 *   flag ON  → card_required          (a card-required trial starts only from
 *                                      Grow's verified callback)
 *   flag OFF → billing_not_available  ("never open a trial we cannot bill" —
 *                                      Payment Links were the only way a
 *                                      no-card trial ever converted)
 *
 * hasBillingPath() and isCardRequiredTrialEnabledForAgency() read the same
 * flag, so startTrialForAgency() is now unreachable from this action and
 * trial.started can no longer fire from it. The card flow sends its own email:
 * app/api/payments/grow/notify dispatches trial.card_started after
 * confirmCardSetup succeeds.
 *
 * So the cases are rewritten to assert the refusals, rather than deleted. What
 * they protect is the part that still matters and is easy to regress: neither
 * refusal may touch the database or send anything. A future change that lets
 * this action start a trial again, or email about one it did not start, fails
 * here.
 */
describe('startTrial → refuses, writes nothing, sends nothing', () => {
  it('flag ON: card_required — a card-required trial starts only from Grow’s verified callback', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    vi.mocked(requireAgencyUser).mockResolvedValueOnce(ACTIVATOR)

    const res = await startTrial()

    expect(res).toEqual({ error: 'card_required' })
    expect(startTrialForAgency).not.toHaveBeenCalled()
    expect(dispatchLifecycleEvent).not.toHaveBeenCalled()
  })

  it('flag OFF: billing_not_available — never open a trial we cannot bill', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '')
    vi.mocked(requireAgencyUser).mockResolvedValueOnce(ACTIVATOR)

    const res = await startTrial()

    expect(res).toEqual({ error: 'billing_not_available' })
    expect(startTrialForAgency).not.toHaveBeenCalled()
    expect(dispatchLifecycleEvent).not.toHaveBeenCalled()
  })

  it('the pilot allowlist is card_required too — one agency cannot be offered click-to-start', async () => {
    // The allowlist widens WHO is asked for a card. An agency on it must not
    // find a second, no-card way in: that is the trial with no billable card.
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', String(ACTIVATOR.agencyId))
    vi.mocked(requireAgencyUser).mockResolvedValueOnce(ACTIVATOR)

    const res = await startTrial()

    expect(res).toEqual({ error: 'card_required' })
    expect(startTrialForAgency).not.toHaveBeenCalled()
    expect(dispatchLifecycleEvent).not.toHaveBeenCalled()
  })

  it('unauthorized callers get no trial and no email (gating unchanged)', async () => {
    vi.mocked(requireAgencyUser).mockRejectedValueOnce(new AuthError('no_session'))

    const res = await startTrial()

    expect(res).toEqual({ error: 'unauthorized' })
    expect(startTrialForAgency).not.toHaveBeenCalled()
    expect(dispatchLifecycleEvent).not.toHaveBeenCalled()
  })
})
