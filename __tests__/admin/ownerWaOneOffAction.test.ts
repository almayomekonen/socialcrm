import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The platform-owner one-off Server Action: ownership re-checked inside the
 * action, suspended owners refused, a validated id only, mode fixed to
 * `immediate`, every attempt audited without personal data, nothing retried.
 */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }))
vi.mock('@/db/auth', () => ({ getUser: async () => session.user }))
const oneOff = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/ownerWhatsappReminders/oneOffSend', () => ({ ONE_OFF_AGENCY_ID: 103, sendOneOffReminder: (...a: unknown[]) => oneOff.send(...a) }))
const analytics = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/track', () => ({ track: analytics.track }))

import { sendOwnerWaOneOffTestAction } from '@/actions/admin/ownerWaOneOff'

const OWNER = { id: 332, email: 'owner@crm.test', role: 'ADMIN', agencyId: 103, suspended: false }
const PHONE = '972500000056'

beforeEach(() => {
  process.env.PLATFORM_OWNER_EMAILS = 'owner@crm.test'
  session.user = { ...OWNER }
  oneOff.send.mockReset()
  analytics.track.mockClear()
  oneOff.send.mockResolvedValue({ outcome: 'sent', deliveryId: 9, wamid: 'wamid.ACCEPTED' })
})
afterEach(() => {
  delete process.env.PLATFORM_OWNER_EMAILS
  vi.restoreAllMocks()
})

describe('authorization inside the action', () => {
  it.each([
    ['no session', null],
    ['a user who is not a platform owner', { ...OWNER, email: 'someone@crm.test' }],
    ['an agency-103 workspace ADMIN who is not a platform owner', { ...OWNER, id: 400, email: 'admin103@crm.test' }],
    ['a suspended platform owner', { ...OWNER, suspended: true }],
  ])('%s: forbidden, nothing sent, nothing audited', async (_label, user) => {
    session.user = user
    expect(await sendOwnerWaOneOffTestAction(20527)).toEqual({ outcome: 'forbidden' })
    expect(oneOff.send).not.toHaveBeenCalled()
    expect(analytics.track).not.toHaveBeenCalled()
  })
})

describe('input', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '20527', null, undefined, { conversationId: 20527 }])('%s is invalid and never sent', async (id) => {
    expect(await sendOwnerWaOneOffTestAction(id)).toEqual({ outcome: 'invalid' })
    expect(oneOff.send).not.toHaveBeenCalled()
  })

  it('an owner call passes only the id, with the mode fixed to immediate', async () => {
    expect(await sendOwnerWaOneOffTestAction(20527)).toEqual({ outcome: 'sent', deliveryId: 9, wamid: 'wamid.ACCEPTED' })
    expect(oneOff.send).toHaveBeenCalledTimes(1)
    expect(oneOff.send).toHaveBeenCalledWith({ conversationId: 20527, mode: 'immediate' })
  })
})

describe('audit', () => {
  it('records the attempt with ids and the outcome only', async () => {
    oneOff.send.mockResolvedValueOnce({ outcome: 'failed', deliveryId: 9, scope: 'recipient', code: '131026' })
    await sendOwnerWaOneOffTestAction(20527)
    expect(analytics.track).toHaveBeenCalledTimes(1)
    expect(analytics.track).toHaveBeenCalledWith({
      agencyId: 103,
      userId: 332,
      event: 'owner_wa_one_off_send',
      props: { conversationId: 20527, mode: 'immediate', outcome: 'failed', scope: 'recipient', code: '131026', deliveryId: 9 },
    })
  })

  it('never puts a phone number, token, secret or message id in the audit', async () => {
    process.env.CRON_SECRET = 'cron-secret-not-real'
    process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = 'EAAG_action_token_not_real_0123456789'
    await sendOwnerWaOneOffTestAction(20527)
    const audit = JSON.stringify(analytics.track.mock.calls)
    for (const s of [PHONE, 'cron-secret-not-real', 'EAAG_action_token_not_real_0123456789', 'wamid.ACCEPTED']) expect(audit).not.toContain(s)
    delete process.env.CRON_SECRET
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN
  })
})

describe('failure modes: final, never retried', () => {
  it.each([
    [{ outcome: 'unknown', deliveryId: 9, reason: 'timeout' }],
    [{ outcome: 'failed', deliveryId: 9, scope: 'rate_limit', code: '130429' }],
    [{ outcome: 'refused', reason: 'already_used' }],
    [{ outcome: 'cancelled', deliveryId: 9, reason: 'recipient_not_active' }],
  ])('%o is returned as is, after exactly one call', async (outcome) => {
    oneOff.send.mockResolvedValueOnce(outcome)
    expect(await sendOwnerWaOneOffTestAction(20527)).toEqual(outcome)
    expect(oneOff.send).toHaveBeenCalledTimes(1)
    expect(analytics.track).toHaveBeenCalledTimes(1)
  })

  it('an exception is `error`, audited once, with no second attempt', async () => {
    oneOff.send.mockRejectedValueOnce(Object.assign(new Error(`boom ${PHONE}`), { code: 'ECONNRESET' }))
    expect(await sendOwnerWaOneOffTestAction(20527)).toEqual({ outcome: 'error' })
    expect(oneOff.send).toHaveBeenCalledTimes(1)
    expect(analytics.track).toHaveBeenCalledWith(expect.objectContaining({ props: { conversationId: 20527, mode: 'immediate', outcome: 'error' } }))
  })
})
