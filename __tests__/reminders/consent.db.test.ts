/**
 * Consent v5 against real Postgres (Reminder Engine Phase 4):
 *   - Settings opt-in only, never automatic, never a downgrade;
 *   - withdrawals and opt-outs cancel future personal reminders atomically;
 *   - execution and the send gate fail closed without v5;
 *   - a withdrawal or opt-out racing the send gate: serialized, never deadlocked.
 * Races are ordered by holding the recipient row lock and queueing contenders.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ user: null as null | { id: number; agencyId: number } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/requireUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/requireUser')>()
  const requireAgencyUser = async () => {
    if (!session.user) throw new actual.AuthError('no_session')
    return session.user
  }
  return { ...actual, requireAgencyUser, requireProductAccess: requireAgencyUser }
})

import { db } from '@/config/db'
import {
  grantPersonalReminders,
  grantWhatsappAssistantConsent,
  turnOffWhatsappReminders,
  withdrawPersonalReminders,
  withdrawWhatsappAssistantConsent,
} from '@/actions/whatsappReminders'
import { OWNER_WA_ASSISTANT_CONSENT, OWNER_WA_PERSONAL_REMINDERS_CONSENT } from '@/lib/whatsapp/platform/consentText'
import { optOutByPhone } from '@/db/ownerWhatsappRecipients'
import { enterDispatch } from '@/db/ownerPersonalReminders/dispatchGate'
import { scheduleApprovedDraft } from '@/db/ownerPersonalReminders/schedule'
import { withdrawPersonalRemindersConsent } from '@/db/ownerPersonalReminders/consent'
import { insertApproval, insertDraft, seedOwner, untilLockWaiters, type Owner } from './fixtures'
import { enableDelivery, inboundFrom, resetControls } from './deliveryFixtures'

const T = 'owner_personal_reminders'
const HOUR = 3_600_000
const owners: Owner[] = []
let seq = 0

const ENV_KEYS = ['PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_WA_ME_NUMBER', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_REMINDERS_AGENCY_IDS']
function setEnv(remindersOn: boolean) {
  const ids = owners.map((o) => o.agencyId).join(',')
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000009'
  process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER = '972500000000'
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = ids
  process.env.WA_ASSISTANT_AGENCY_IDS = ids
  if (remindersOn) process.env.WA_ASSISTANT_REMINDERS_AGENCY_IDS = ids
  else delete process.env.WA_ASSISTANT_REMINDERS_AGENCY_IDS
}

async function owner(name: string, consent = 'v4'): Promise<Owner> {
  const o = await seedOwner(name)
  await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ consentTextVersion: consent })
  await inboundFrom(o, Date.now() - 60_000)
  owners.push(o)
  return o
}
const consentOf = async (o: Owner) => ((await db('owner_whatsapp_recipients').where({ id: o.recipientId }).first('consentTextVersion')) as { consentTextVersion: string }).consentTextVersion
const statusOf = async (id: number) => ((await db(T).where({ id }).first('status')) as { status: string }).status
const as = (o: Owner) => {
  session.user = { id: o.userId, agencyId: o.agencyId }
}

/** A reminder in a given lifecycle state, inserted directly. */
async function reminder(o: Owner, status: 'scheduled' | 'claimed' | 'dispatching', claimToken = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`) {
  const remindAt = new Date(Date.now() + HOUR)
  const [r] = await db(T)
    .insert({
      agencyId: o.agencyId, userId: o.userId, recipientId: o.recipientId, text: 'להתקשר לאבי', textLength: 11, remindAt,
      anchorMessageTs: Math.floor(Date.now() / 1000), sourceWamid: `wamid.c.${++seq}`, status,
      nextAttemptAt: remindAt, createdByActionId: `rem_${800000 + seq}_v1_create`,
      ...(status === 'claimed' ? { claimToken, claimedAt: new Date() } : {}),
      ...(status === 'dispatching' ? { claimToken, claimedAt: new Date(), dispatchedAt: new Date() } : {}),
    })
    .returning('id')
  return { id: Number(r.id), claimToken }
}

async function holdRecipient(o: Owner) {
  const trx = await db.transaction()
  await trx('owner_whatsapp_recipients').where({ id: o.recipientId }).forUpdate().first('id')
  return { release: () => trx.commit() }
}

beforeAll(async () => {
  session.user = null
  // Synthetic controls so the full Phase 5 gate can reach `dispatching`.
  await enableDelivery()
})
afterAll(async () => {
  await resetControls()
  for (const k of ENV_KEYS) delete process.env[k]
  await db.destroy()
})

describe('opt-in: Settings only, explicit, never automatic', () => {
  it('without the switch it is refused; with it, an explicit tick on the v5 text records v5 and an event', async () => {
    const o = await owner('grant')
    setEnv(false)
    as(o)
    expect(await grantPersonalReminders({ consent: true, consentVersion: 'v5' })).toEqual({ fail: true, msg: 'התזכורות האישיות אינן זמינות לחשבון זה' })
    setEnv(true)
    expect(await grantPersonalReminders({ consent: false, consentVersion: 'v5' })).toMatchObject({ fail: true })
    expect(await grantPersonalReminders({ consent: true, consentVersion: OWNER_WA_ASSISTANT_CONSENT.version })).toMatchObject({ fail: true, msg: expect.stringContaining('נוסח ההסכמה') })
    expect(await consentOf(o)).toBe('v4')
    expect(await grantPersonalReminders({ consent: true, consentVersion: OWNER_WA_PERSONAL_REMINDERS_CONSENT.version })).toEqual({ ok: true })
    expect(await consentOf(o)).toBe('v5')
    expect(await db('owner_personal_reminder_events').where({ recipientId: o.recipientId, type: 'consent_granted' })).toMatchObject([
      { consentFrom: 'v4', consentTo: 'v5', actorKind: 'settings' },
    ])
  })

  it('an unverified (not active) row cannot opt in', async () => {
    const o = await owner('grant-inactive')
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ status: 'opted_out', optedOutAt: new Date(), optOutSource: 'settings' })
    setEnv(true)
    as(o)
    expect(await grantPersonalReminders({ consent: true, consentVersion: 'v5' })).toEqual({ fail: true, msg: 'קודם צריך להפעיל ולאמת את המספר' })
  })

  it('no automatic migration: granting the assistant keeps v4, and never downgrades a v5', async () => {
    const v4 = await owner('no-auto', 'v2')
    const v5 = await owner('no-downgrade', 'v5')
    setEnv(true)
    as(v4)
    await grantWhatsappAssistantConsent({ consent: true, consentVersion: OWNER_WA_ASSISTANT_CONSENT.version })
    expect(await consentOf(v4)).toBe('v4')
    as(v5)
    expect(await grantWhatsappAssistantConsent({ consent: true, consentVersion: OWNER_WA_ASSISTANT_CONSENT.version })).toEqual({ ok: true })
    expect(await consentOf(v5)).toBe('v5')
  })
})

describe('withdrawals and opt-outs cancel future personal reminders, atomically', () => {
  async function seeded(name: string) {
    const o = await owner(name, 'v5')
    const scheduled = await reminder(o, 'scheduled')
    const claimed = await reminder(o, 'claimed')
    const flying = await reminder(o, 'dispatching')
    const draftId = await insertDraft(o, { proposalActionId: `rem_d${++seq}_v1_create` })
    const draftAction = ((await db(T).where({ id: draftId }).first('proposalActionId')) as { proposalActionId: string }).proposalActionId
    const token = await insertApproval(o, draftAction)
    return { o, scheduled, claimed, flying, draftId, token }
  }

  it('withdrawing personal reminders: v5 → v4; scheduled and claimed cancelled; the draft discarded and its card expired; the one in flight is reported', async () => {
    const s = await seeded('wd-personal')
    as(s.o)
    expect(await withdrawPersonalReminders()).toEqual({ ok: true, inFlight: 1 })
    expect(await consentOf(s.o)).toBe('v4')
    expect(await db(T).where({ id: s.scheduled.id }).first('status', 'cancelReason')).toEqual({ status: 'cancelled', cancelReason: 'consent_withdrawn' })
    expect(await db(T).where({ id: s.claimed.id }).first('status', 'cancelReason')).toEqual({ status: 'cancelled', cancelReason: 'consent_withdrawn' })
    expect(await db(T).where({ id: s.draftId }).first('status', 'discardReason', 'text')).toEqual({ status: 'discarded', discardReason: 'consent', text: null })
    expect(await db('wa_assistant_approvals').where({ token: s.token }).first('status')).toEqual({ status: 'expired' })
    expect(await statusOf(s.flying.id)).toBe('dispatching')
    expect(await db('owner_personal_reminder_events').where({ recipientId: s.o.recipientId, type: 'consent_withdrawn' })).toMatchObject([{ consentFrom: 'v5', consentTo: 'v4' }])
  })

  it('withdrawing personal reminders without v5 changes nothing', async () => {
    const o = await owner('wd-none')
    as(o)
    expect(await withdrawPersonalReminders()).toEqual({ ok: true, inFlight: 0 })
    expect(await consentOf(o)).toBe('v4')
  })

  it('withdrawing the assistant from v5 → v2, and cancels personal reminders too', async () => {
    const s = await seeded('wd-assistant')
    as(s.o)
    await withdrawWhatsappAssistantConsent()
    expect(await consentOf(s.o)).toBe('v2')
    expect(await statusOf(s.scheduled.id)).toBe('cancelled')
  })

  it('turning everything off in Settings (opt-out) cancels them, reason opted_out', async () => {
    const s = await seeded('optout-settings')
    as(s.o)
    await turnOffWhatsappReminders()
    expect(await db(T).where({ id: s.scheduled.id }).first('cancelReason')).toEqual({ cancelReason: 'opted_out' })
    expect(await statusOf(s.draftId)).toBe('discarded')
  })

  it('the "הסר" keyword cancels them for every agency on that number', async () => {
    const s = await seeded('optout-keyword')
    const phone = ((await db('owner_whatsapp_recipients').where({ id: s.o.recipientId }).first('phoneE164')) as { phoneE164: string }).phoneE164
    await db.transaction((trx) => optOutByPhone(trx, phone, Math.floor(Date.now() / 1000)))
    expect(await db(T).where({ id: s.claimed.id }).first('status', 'cancelReason')).toEqual({ status: 'cancelled', cancelReason: 'opted_out' })
  })
})

describe('fail closed without v5', () => {
  it('approval-time scheduling: a v4 recipient’s draft is discarded as consent', async () => {
    const o = await owner('t5-v4')
    const id = await insertDraft(o)
    const remindAt = ((await db(T).where({ id }).first('remindAt')) as { remindAt: Date }).remindAt
    const r = await scheduleApprovedDraft({ reminderId: id, version: 1, remindAtMs: new Date(remindAt).getTime(), actionId: `rem_${id}_v1_create`, owner: o, nowMs: Date.now() })
    expect(r).toEqual({ kind: 'rejected', reason: 'consent' })
    expect(await db(T).where({ id }).first('status', 'discardReason')).toEqual({ status: 'discarded', discardReason: 'consent' })
  })

  it('the send gate: v5 + active → dispatching; v4 → cancelled; opted out → cancelled; wrong claim → untouched', async () => {
    const ok = await owner('gate-ok', 'v5')
    const a = await reminder(ok, 'claimed')
    expect(await enterDispatch({ reminderId: a.id, claimToken: a.claimToken, nowMs: Date.now(), exposure: 0 })).toMatchObject({ result: 'dispatching' })

    const v4 = await owner('gate-v4', 'v4')
    const b = await reminder(v4, 'claimed')
    expect(await enterDispatch({ reminderId: b.id, claimToken: b.claimToken, nowMs: Date.now(), exposure: 0 })).toEqual({ result: 'cancelled', reason: 'consent_withdrawn' })

    const gone = await owner('gate-out', 'v5')
    const c = await reminder(gone, 'claimed')
    await db('owner_whatsapp_recipients').where({ id: gone.recipientId }).update({ status: 'opted_out', optedOutAt: new Date(), optOutSource: 'keyword' })
    expect(await enterDispatch({ reminderId: c.id, claimToken: c.claimToken, nowMs: Date.now(), exposure: 0 })).toEqual({ result: 'cancelled', reason: 'opted_out' })

    const wrong = await owner('gate-token', 'v5')
    const d = await reminder(wrong, 'claimed')
    expect(await enterDispatch({ reminderId: d.id, claimToken: '00000000-0000-4000-8000-999999999999', nowMs: Date.now(), exposure: 0 })).toEqual({ result: 'not_claimed', status: 'claimed' })
    expect(await statusOf(d.id)).toBe('claimed')
  })
})

describe('concurrency: withdrawal and opt-out against the send gate', () => {
  it('gate first, withdrawal second: the send proceeds and the withdrawal reports it as in flight', async () => {
    const o = await owner('race-gate-first', 'v5')
    const r = await reminder(o, 'claimed')
    const hold = await holdRecipient(o)
    const gate = enterDispatch({ reminderId: r.id, claimToken: r.claimToken, nowMs: Date.now(), exposure: 0 })
    await untilLockWaiters(1)
    const withdraw = withdrawPersonalRemindersConsent(o.agencyId, o.userId)
    await untilLockWaiters(2)
    await hold.release()
    const [g, w] = await Promise.all([gate, withdraw])
    expect(g).toMatchObject({ result: 'dispatching' })
    expect(w).toMatchObject({ result: 'withdrawn', inFlight: 1, cancelled: 0 })
    expect(await consentOf(o)).toBe('v4')
  })

  it('withdrawal first, gate second: the reminder is cancelled and never dispatched', async () => {
    const o = await owner('race-withdraw-first', 'v5')
    const r = await reminder(o, 'claimed')
    const hold = await holdRecipient(o)
    const withdraw = withdrawPersonalRemindersConsent(o.agencyId, o.userId)
    await untilLockWaiters(1)
    const gate = enterDispatch({ reminderId: r.id, claimToken: r.claimToken, nowMs: Date.now(), exposure: 0 })
    await untilLockWaiters(2)
    await hold.release()
    const [w, g] = await Promise.all([withdraw, gate])
    expect(w).toMatchObject({ result: 'withdrawn', cancelled: 1, inFlight: 0 })
    expect(g).toEqual({ result: 'not_claimed', status: 'cancelled' })
    expect(await db(T).where({ id: r.id }).first('status', 'dispatchedAt')).toEqual({ status: 'cancelled', dispatchedAt: null })
  })

  it('a keyword opt-out racing the gate never deadlocks, in either order', async () => {
    for (const optOutFirst of [true, false]) {
      const o = await owner(`race-kw-${optOutFirst}`, 'v5')
      const r = await reminder(o, 'claimed')
      const phone = ((await db('owner_whatsapp_recipients').where({ id: o.recipientId }).first('phoneE164')) as { phoneE164: string }).phoneE164
      const optOut = () => db.transaction((trx) => optOutByPhone(trx, phone, Math.floor(Date.now() / 1000)))
      const gate = () => enterDispatch({ reminderId: r.id, claimToken: r.claimToken, nowMs: Date.now(), exposure: 0 })
      const hold = await holdRecipient(o)
      const first = optOutFirst ? optOut() : gate()
      await untilLockWaiters(1)
      const second = optOutFirst ? gate() : optOut()
      await untilLockWaiters(2)
      await hold.release()
      await expect(Promise.all([first, second])).resolves.toBeDefined()
      expect(await statusOf(r.id)).toBe(optOutFirst ? 'cancelled' : 'dispatching')
    }
  })
})
