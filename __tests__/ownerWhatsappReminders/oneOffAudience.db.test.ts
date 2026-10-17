import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { ONE_OFF_AGENCY_ID, sendOneOffReminder } from '@/lib/ownerWhatsappReminders/oneOffSend'
import { MIN, ago, agency, cleanup, clearEnv, conversation, deliveries, escalateWithMicros, mockGraph, recipient, resetBetweenTests, user } from './reminderFixtures'
import { setOneOffEnv } from './oneOffFixtures'

/** The one-off stays its own path (agency 103, its own recipient), under either audience mode, with product access enforced. */
const trial = vi.hoisted(() => ({ failAfter: Infinity, calls: 0 }))
vi.mock('@/db/trial', async (orig) => {
  const real = await orig<typeof import('@/db/trial')>()
  return { ...real, getAgencyTrial: async (id: number) => { if (++trial.calls > trial.failAfter) throw new Error('db down'); return real.getAgencyTrial(id) } }
})

const A = ONE_OFF_AGENCY_ID

async function handoff(digits: string) {
  const admin = await user(A)
  const recipientId = await recipient(A, admin, digits)
  const c = await conversation(A, { lead: false })
  await escalateWithMicros(c, ago(5 * MIN))
  setOneOffEnv(recipientId)
  return { c, recipientId }
}
const audienceAll = (excluded = '') => {
  delete process.env.OWNER_WA_REMINDERS_AGENCY_IDS
  process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
  process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS = excluded
}

beforeAll(async () => {
  await agency('__owr_oneoff_aud_103__', A)
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('agencies').where({ id: A }).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  clearEnv()
  for (const k of ['OWNER_WA_ONE_OFF_RECIPIENT_ID', 'OWNER_WA_REMINDERS_AUDIENCE', 'OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS']) delete process.env[k]
  trial.failAfter = Infinity
  trial.calls = 0
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  for (const k of ['OWNER_WA_ONE_OFF_RECIPIENT_ID', 'OWNER_WA_REMINDERS_AUDIENCE', 'OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS']) delete process.env[k]
  await cleanup()
})

describe('one-off under the audience model', () => {
  it('works in audience all (still needs its own recipient variable)', async () => {
    const h = await handoff('972500003001')
    audienceAll()
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toMatchObject({ outcome: 'sent' })
    expect(g.calls).toHaveLength(1)
  })

  it('refused when agency 103 is excluded', async () => {
    const h = await handoff('972500003002')
    audienceAll(String(A))
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'agency_not_allowlisted' })
    expect(g.calls).toEqual([])
  })

  it('refused without product access, before anything is written', async () => {
    const h = await handoff('972500003003')
    await db('agencies').where({ id: A }).update({ plan: 'free', trialStartedAt: ago(10 * 24 * 60 * MIN), trialEndsAt: ago(3 * 24 * 60 * MIN) })
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'agency_no_access' })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
  })

  it('an access-lookup error right before sending cancels it (fail closed); the allowance is not used', async () => {
    const h = await handoff('972500003004')
    trial.failAfter = 1 // the first check passes, the pre-send check errors
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toMatchObject({ outcome: 'cancelled', reason: 'agency_no_access' })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toMatchObject([{ status: 'cancelled', cancelReason: 'agency_no_access' }])
  })
})
