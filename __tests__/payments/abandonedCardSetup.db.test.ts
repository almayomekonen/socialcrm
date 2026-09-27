import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { db } from '@/config/db'
import { welcomeCardStage } from '@/lib/payments/cardTrial/availability'
import { seedAgency, seedMethod, cleanupBilling } from './helpers/billingFixtures'

/**
 * OPENING GROW'S PAGE IS NOT SAVING A CARD.
 *
 * The row is written when the customer presses the button — before the hosted
 * page opens and long before a card is typed. Reading `pending` as "awaiting
 * verification" told anyone who opened that window and closed it
 * "הכרטיס נשמר, ואנחנו מאמתים אותו", and left them there permanently: the only
 * exit from 'awaiting' is a callback that was never coming. Production agency
 * 157 sat in it with a pending row, no callback and no token.
 *
 * `lastCallbackAt` is the evidence that separates the two, and these cases pin
 * each state the flow can actually be in.
 */

const provider = () => {
  vi.stubEnv('APP_ENV', 'staging')
  vi.stubEnv('GROW_MODE', 'sandbox')
  vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
  vi.stubEnv('GROW_USER_ID', 'u')
  vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'p')
  vi.stubEnv('APP_HOST', 'staging.example.com')
  vi.stubEnv('VERCEL_ENV', 'preview')
}

const pending = (agencyId: number, over: Record<string, unknown> = {}) =>
  seedMethod(agencyId, {
    status: 'pending',
    cardToken: null,
    confirmedAt: null,
    setupProcessId: `p-${agencyId}-${Math.random()}`,
    holderFullName: 'ישראל ישראלי',
    holderPhone: '0501112222',
    ...over,
  })

afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

describe('the hosted window was closed without a card', () => {
  it('offers the form again instead of claiming the card was saved', async () => {
    provider()
    const agencyId = await seedAgency()
    await pending(agencyId)

    const state = await welcomeCardStage(agencyId)

    expect(state.stage).toBe('setup')
    expect(state.stage).not.toBe('awaiting')
  })

  it('brings back the name and phone, and never a consent', async () => {
    provider()
    const agencyId = await seedAgency()
    await pending(agencyId)

    const { resume } = await welcomeCardStage(agencyId)

    expect(resume).toEqual({ fullName: 'ישראל ישראלי', phone: '0501112222' })
    // Consent is not part of what is carried over: the form mounts both boxes
    // unticked and the server refuses a submission without them.
    expect(Object.keys(resume ?? {})).toEqual(['fullName', 'phone'])
  })

  it('writes NOTHING — a closed window is not proof of cancellation', async () => {
    provider()
    const agencyId = await seedAgency()
    const id = await pending(agencyId)
    const before = await db('billing_payment_methods').where({ id }).first()

    await welcomeCardStage(agencyId)

    const after = await db('billing_payment_methods').where({ id }).first()
    expect(after.status).toBe('pending')
    expect(after.invalidReason).toBeNull()
    expect(String(after.updatedAt)).toBe(String(before.updatedAt))
  })
})

describe('the states are told apart', () => {
  it('a callback that arrived IS verification in progress', async () => {
    provider()
    const agencyId = await seedAgency()
    await pending(agencyId, { lastCallbackAt: new Date() })

    const state = await welcomeCardStage(agencyId)

    expect(state.stage).toBe('awaiting')
    expect(state.resume).toBeNull()
  })

  it('a verified card is never sent back to the form', async () => {
    provider()
    const agencyId = await seedAgency()
    await seedMethod(agencyId) // active, confirmed

    expect((await welcomeCardStage(agencyId)).stage).toBe('awaiting')
  })

  it('an explicitly cancelled setup offers the form, with nothing to resume', async () => {
    provider()
    const agencyId = await seedAgency()
    await pending(agencyId, { status: 'invalid', invalidReason: 'superseded_by_newer_setup' })

    const state = await welcomeCardStage(agencyId)

    expect(state.stage).toBe('setup')
    expect(state.resume).toBeNull()
  })
})

describe('the race around the closing window', () => {
  /**
   * The customer completes the save and closes the window in the same breath.
   * The form may be shown for one render — then the callback lands, and because
   * showing it wrote nothing, the row is still there to be completed.
   */
  it('a callback landing after the form was shown still wins', async () => {
    provider()
    const agencyId = await seedAgency()
    const id = await pending(agencyId)

    expect((await welcomeCardStage(agencyId)).stage).toBe('setup')

    // Grow calls back a moment later.
    await db('billing_payment_methods').where({ id }).update({ lastCallbackAt: new Date() })

    const after = await welcomeCardStage(agencyId)
    expect(after.stage).toBe('awaiting')
    expect(after.resume).toBeNull()
  })

  it('reloading an abandoned setup is stable and still writes nothing', async () => {
    provider()
    const agencyId = await seedAgency()
    const id = await pending(agencyId)

    const first = await welcomeCardStage(agencyId)
    const second = await welcomeCardStage(agencyId)

    expect(second).toEqual(first)
    expect((await db('billing_payment_methods').where({ id }).first()).status).toBe('pending')
  })

  it('a retry cannot double-activate: an active card outranks any leftover pending row', async () => {
    provider()
    const agencyId = await seedAgency()
    await pending(agencyId)
    await seedMethod(agencyId) // the retry that succeeded

    // getLatestPaymentMethod returns the newest row; a confirmed card is
    // 'awaiting' (its trial write may still be landing) and never a fresh form,
    // so the customer cannot start a second activation from this screen.
    expect((await welcomeCardStage(agencyId)).stage).toBe('awaiting')
    expect(await db('billing_payment_methods').where({ agencyId, status: 'active' })).toHaveLength(1)
  })
})
