/**
 * actions/trial.startTrial — the immediate "Pro trial started" email trigger.
 *
 * Fully mocked / DB-free (VITEST_NO_DB-safe): the DB transition, the email
 * dispatcher, and next/{cache,server} are all stubbed. Proves the wiring
 * contract: fire exactly once on the real transition, never otherwise, to the
 * authenticated activator, and never let email delivery fail or roll back the
 * trial.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

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

describe('startTrial → trial.started email', () => {
  it('started=true schedules EXACTLY ONE trial.started event to the activator', async () => {
    vi.mocked(requireAgencyUser).mockResolvedValueOnce(ACTIVATOR)
    vi.mocked(startTrialForAgency).mockResolvedValueOnce({ started: true })

    const res = await startTrial()

    expect(res).toEqual({ ok: true, started: true })
    expect(dispatchLifecycleEvent).toHaveBeenCalledTimes(1)
    const [event, recipient] = vi.mocked(dispatchLifecycleEvent).mock.calls[0]
    expect(event).toBe('trial.started')
    // Recipient is the authenticated activator; firstName derived from name.
    expect(recipient).toEqual({
      userId: 7,
      agencyId: 3,
      email: 'activator@example.com',
      firstName: 'דוד',
    })
  })

  it('started=false (refresh / re-view / double-click / already-started / PAID / expired) schedules NONE', async () => {
    vi.mocked(requireAgencyUser).mockResolvedValueOnce(ACTIVATOR)
    vi.mocked(startTrialForAgency).mockResolvedValueOnce({ started: false })

    const res = await startTrial()

    expect(res).toEqual({ ok: true, started: false })
    expect(dispatchLifecycleEvent).not.toHaveBeenCalled()
  })

  it('email dispatch failure cannot fail or roll back trial activation', async () => {
    vi.mocked(requireAgencyUser).mockResolvedValueOnce(ACTIVATOR)
    vi.mocked(startTrialForAgency).mockResolvedValueOnce({ started: true })
    vi.mocked(dispatchLifecycleEvent).mockRejectedValueOnce(new Error('email provider down'))

    // Must resolve normally — no throw despite the rejected dispatch.
    const res = await startTrial()

    expect(res).toEqual({ ok: true, started: true })
    // The trial transition ran exactly once and was not re-attempted/undone.
    expect(startTrialForAgency).toHaveBeenCalledTimes(1)
    expect(startTrialForAgency).toHaveBeenCalledWith(3, 7)
  })

  it('unauthorized callers get no trial and no email (gating unchanged)', async () => {
    vi.mocked(requireAgencyUser).mockRejectedValueOnce(new AuthError('no_session'))

    const res = await startTrial()

    expect(res).toEqual({ error: 'unauthorized' })
    expect(startTrialForAgency).not.toHaveBeenCalled()
    expect(dispatchLifecycleEvent).not.toHaveBeenCalled()
  })
})
