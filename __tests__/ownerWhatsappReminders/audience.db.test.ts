import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { findReminderCandidates } from '@/db/ownerWhatsappReminders/candidates'
import { scheduleReminder } from '@/db/ownerWhatsappReminders/schedule'
import { startOwnActivation } from '@/db/ownerWhatsappRecipients'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { formatActivationCode, generateActivationCode, hashActivationCode } from '@/lib/whatsapp/platform/keys'
import { MIN, PLATFORM, TOKEN, ago, agency, cleanup, conversation, deliveries, escalateWithMicros, mockGraph, recipient, resetBetweenTests, sentTo, user } from './reminderFixtures'

/**
 * The general rollout (`OWNER_WA_REMINDERS_AUDIENCE=all`): every agency with
 * product access and an activated recipient (agency 158 included; exclusions
 * only via OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS), access checked
 * at scheduling AND right before sending (failing closed), and every existing
 * safeguard unchanged. Escalations carry microseconds, as in production.
 *
 * NOTE: just over the 250-line soft limit on purpose: one flat list of
 * independent rollout scenarios sharing the env, access and hand-off helpers;
 * splitting it would duplicate those across files for no readability gain.
 */
const trial = vi.hoisted(() => ({ fail: false }))
vi.mock('@/db/trial', async (orig) => {
  const real = await orig<typeof import('@/db/trial')>()
  return { ...real, getAgencyTrial: async (id: number) => { if (trial.fail) throw new Error('db down'); return real.getAgencyTrial(id) } }
})

let X: number
let Y: number
let A158: number
let seq = 0
const DAY = 24 * 60 * MIN

function setAllEnv(opts: { send?: boolean; excluded?: string } = {}) {
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
  delete process.env.OWNER_WA_REMINDERS_AGENCY_IDS
  if (opts.excluded) process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS = opts.excluded
  else delete process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS
  if (opts.send === false) delete process.env.OWNER_WA_REMINDERS_SEND_ENABLED
  else process.env.OWNER_WA_REMINDERS_SEND_ENABLED = '1'
}

/** Product access states, through the real trial state machine. */
async function setAccess(agencyId: number, state: 'paid' | 'trial' | 'legacy' | 'expired' | 'never') {
  const base = { plan: 'free' as const, planReason: null, trialExempt: false, trialStartedAt: null as Date | null, trialEndsAt: null as Date | null }
  const patch =
    state === 'paid' ? { ...base, plan: 'pro' as const }
    : state === 'legacy' ? { ...base, trialExempt: true }
    : state === 'trial' ? { ...base, trialStartedAt: ago(DAY), trialEndsAt: new Date(Date.now() + 6 * DAY) }
    : state === 'expired' ? { ...base, trialStartedAt: ago(10 * DAY), trialEndsAt: ago(3 * DAY) }
    : base
  await db('agencies').where({ id: agencyId }).update(patch)
}

/** A due hand-off (microsecond escalation) in `agencyId`, with one active ADMIN recipient there. */
async function dueHandoff(agencyId: number, digits: string) {
  const admin = await user(agencyId)
  const recipientId = await recipient(agencyId, admin, digits)
  const c = await conversation(agencyId, { lead: false })
  await escalateWithMicros(c, ago(121 * MIN))
  return { c, admin, recipientId }
}

const stop = (digits: string) =>
  processPlatformMessage({ id: `wamid.__owr_aud_stop_${++seq}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'הסר' } })

beforeAll(async () => {
  X = await agency('__owr_aud_x__')
  Y = await agency('__owr_aud_y__')
  A158 = await agency('__owr_aud_158__', 158)
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('auto_response_settings').whereIn('agencyId', [X, Y, A158]).del()
  for (const id of [X, Y, A158]) await setAccess(id, 'paid')
  trial.fail = false
  setAllEnv()
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  for (const k of ['OWNER_WA_REMINDERS_AUDIENCE', 'OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS']) delete process.env[k]
  await cleanup()
})

describe('audience all', () => {
  it('reminds an agency that is in no explicit list, once, with the exact escalation stored', async () => {
    const h = await dueHandoff(X, '972500002001')
    const g = mockGraph()
    const tick = await tickOwnerWhatsappReminders()
    expect(tick).toMatchObject({ mode: 'live', scheduled: 1, noAccess: 0, sends: { sent: 1 } })
    expect(sentTo(g.calls)).toEqual(['972500002001'])
    const { rows } = await db.raw(`SELECT r."escalatedAt" = ai."escalatedAt" AS equal FROM owner_whatsapp_reminders r JOIN conversation_ai_state ai USING ("conversationId") WHERE r."conversationId" = ?`, [h.c.id])
    expect(rows[0].equal).toBe(true)
    await tickOwnerWhatsappReminders()
    expect(g.calls).toHaveLength(1)
  })

  it('agency 158 is reminded like any eligible agency (no exclusion in code)', async () => {
    await dueHandoff(A158, '972500002002')
    const g = mockGraph()
    expect((await findReminderCandidates(new Date(), { mode: 'all', excludedIds: [] }, 10)).map((c) => c.agencyId)).toEqual([158])
    const tick = await tickOwnerWhatsappReminders()
    expect(tick).toMatchObject({ candidates: 1, scheduled: 1, sends: { sent: 1 } })
    expect(sentTo(g.calls)).toEqual(['972500002002'])
  })

  it('agency 158 is excluded only when OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS names it', async () => {
    await dueHandoff(A158, '972500002005')
    setAllEnv({ excluded: '158' })
    const g = mockGraph()
    expect((await tickOwnerWhatsappReminders()).candidates).toBe(0)
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
  })

  it('an agency in OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS is never reminded', async () => {
    await dueHandoff(X, '972500002003')
    setAllEnv({ excluded: String(X) })
    const g = mockGraph()
    expect((await tickOwnerWhatsappReminders()).candidates).toBe(0)
    expect(g.calls).toEqual([])
  })

  it('without the send flag it is a dry run: counts only, nothing written, nothing sent', async () => {
    await dueHandoff(X, '972500002004')
    setAllEnv({ send: false })
    const g = mockGraph()
    const tick = await tickOwnerWhatsappReminders()
    expect(tick).toMatchObject({ mode: 'dry_run', candidates: 1, wouldRemind: 1, scheduled: 0 })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
    expect(await db('owner_whatsapp_reminders')).toEqual([])
  })
})

describe('product access', () => {
  it.each(['paid', 'trial', 'legacy'] as const)('%s: reminded', async (state) => {
    await dueHandoff(X, '972500002011')
    await setAccess(X, state)
    const g = mockGraph()
    expect((await tickOwnerWhatsappReminders()).sends).toEqual({ sent: 1 })
    expect(g.calls).toHaveLength(1)
  })

  it.each(['expired', 'never'] as const)('%s: not scheduled, counted as noAccess', async (state) => {
    await dueHandoff(X, '972500002012')
    await setAccess(X, state)
    const g = mockGraph()
    const tick = await tickOwnerWhatsappReminders()
    expect(tick).toMatchObject({ candidates: 1, noAccess: 1, scheduled: 0 })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
  })

  it('access lost between scheduling and sending: cancelled before Meta, never sent later', async () => {
    const h = await dueHandoff(X, '972500002013')
    const now = new Date()
    const [cand] = await findReminderCandidates(now, [X], 10)
    expect(await scheduleReminder({ candidate: cand, recipientIds: [h.recipientId], agencyIds: [X], notBefore: ago(MIN), now })).toBe('scheduled')
    await setAccess(X, 'expired')
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
    expect(await deliveries()).toMatchObject([{ status: 'cancelled', cancelReason: 'agency_no_access' }])
    await setAccess(X, 'paid')
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
  })

  it('an access-lookup error fails closed when scheduling', async () => {
    await dueHandoff(X, '972500002014')
    trial.fail = true
    const g = mockGraph()
    const tick = await tickOwnerWhatsappReminders()
    expect(tick).toMatchObject({ candidates: 1, noAccess: 1, scheduled: 0 })
    expect(g.calls).toEqual([])
  })

  it('an access-lookup error fails closed right before sending', async () => {
    const h = await dueHandoff(X, '972500002015')
    const now = new Date()
    const [cand] = await findReminderCandidates(now, [X], 10)
    await scheduleReminder({ candidate: cand, recipientIds: [h.recipientId], agencyIds: [X], notBefore: ago(MIN), now })
    trial.fail = true
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
    expect(await deliveries()).toMatchObject([{ status: 'cancelled', cancelReason: 'agency_no_access' }])
  })
})

describe('safeguards unchanged in audience all', () => {
  it('tenant isolation: a recipient of X is never used for a Y hand-off', async () => {
    await recipient(X, await user(X), '972500002021')
    const c = await conversation(Y, { lead: false })
    await escalateWithMicros(c, ago(121 * MIN))
    const g = mockGraph()
    const tick = await tickOwnerWhatsappReminders()
    expect(tick).toMatchObject({ candidates: 1, noRecipients: 1, scheduled: 0 })
    expect(g.calls).toEqual([])
  })

  it('consent: a pending (unverified) recipient is never used', async () => {
    const h = await dueHandoff(X, '972500002022')
    await db('owner_whatsapp_recipients').where({ id: h.recipientId }).update({ status: 'pending', phoneE164: null, verifiedAt: null })
    const g = mockGraph()
    expect((await tickOwnerWhatsappReminders()).noRecipients).toBe(1)
    expect(g.calls).toEqual([])
  })

  it('opt-out after scheduling: cancelled, nothing sent', async () => {
    const h = await dueHandoff(X, '972500002023')
    const now = new Date()
    const [cand] = await findReminderCandidates(now, { mode: 'all', excludedIds: [158] }, 10)
    await scheduleReminder({ candidate: cand, recipientIds: [h.recipientId], agencyIds: { mode: 'all', excludedIds: [158] }, notBefore: ago(MIN), now })
    expect(await stop('972500002023')).toBe('opted_out')
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
    expect(await deliveries()).toMatchObject([{ status: 'cancelled', cancelReason: 'recipient_not_active' }])
  })

  it('quiet hours: deferred, not sent', async () => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jerusalem' }).format(new Date()))
    await db('auto_response_settings').insert({ agencyId: X, channel: 'whatsapp', quietHours: { tz: 'Asia/Jerusalem', startHour: hour, endHour: (hour + 2) % 24 } })
    await dueHandoff(X, '972500002024')
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
    expect((await deliveries())[0].status).toBe('scheduled')
  })

  it('cooldown: a new escalation of an already-reminded conversation within 12 hours is not reminded', async () => {
    const h = await dueHandoff(X, '972500002025')
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    await escalateWithMicros(h.c, ago(125 * MIN))
    await tickOwnerWhatsappReminders()
    expect(g.calls).toHaveLength(1)
  })
})

describe('activation in audience all', () => {
  async function activate(agencyId: number, digits: string) {
    const userId = await user(agencyId)
    const code = generateActivationCode()
    await startOwnActivation({ agencyId, userId, codeHash: hashActivationCode(code), expiresAt: new Date(Date.now() + 15 * MIN), consentTextVersion: 'v2' })
    const outcome = await processPlatformMessage({ id: `wamid.__owr_aud_act_${++seq}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: `הפעלת תזכורות SocialCRM: ${formatActivationCode(code)}` } })
    return { outcome, row: await db('owner_whatsapp_recipients').where({ agencyId, userId }).first('status') }
  }

  it('an agency in no explicit list can activate', async () => {
    expect(await activate(X, '972500002031')).toEqual({ outcome: 'activated', row: { status: 'active' } })
  })

  it('agency 158 can, like any eligible agency', async () => {
    expect(await activate(A158, '972500002032')).toEqual({ outcome: 'activated', row: { status: 'active' } })
  })

  it('an excluded agency cannot', async () => {
    setAllEnv({ excluded: String(Y) })
    expect(await activate(Y, '972500002033')).toEqual({ outcome: 'activation_rejected', row: { status: 'pending' } })
  })
})
