/**
 * R9: the owner's in-app notice when their personal WhatsApp reminder was not
 * delivered (`followup.reminder_failed`) or its delivery cannot be confirmed
 * (`followup.reminder_unconfirmed`). Real database, the REAL reminder transitions,
 * the REAL notification queue and worker, the owner's own feed. The Graph sender
 * is always a mock; no WhatsApp message is sent. Synthetic data only.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import { reapStaleDispatches, recordSendOutcome, releaseForFailedStatuses } from '@/db/ownerPersonalReminders/lifecycle'
import { enterDispatch } from '@/db/ownerPersonalReminders/dispatchGate'
import { notifyOwnerReminderNotDelivered } from '@/db/ownerPersonalReminders/notifyOwner'
import { runNotificationWorker } from '@/lib/notifications/worker'
import { listNotifications } from '@/db/notifications/feed'
import { planNotification } from '@/lib/notifications/plan'
import type { PlatformTextOutcome } from '@/lib/whatsapp/platform/sendText'
import { seedUser } from '../mcp/fixtures'
import { enableDelivery, resetControls, readyOwner, insertReminder, T } from './deliveryFixtures'

const MIN = 60_000
const ENV = {
  OWNER_PERSONAL_REMINDERS_SEND_ENABLED: '1', PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000009', PLATFORM_WHATSAPP_ACCESS_TOKEN: 'synthetic-test-token',
  NOTIFICATIONS_ENABLED: '1', NOTIFICATIONS_AGENCY_ALLOWLIST: 'all',
}
const sends = (o: PlatformTextOutcome) => vi.fn(async (_i: unknown) => o)
const tick = (send: ReturnType<typeof vi.fn>, nowMs = Date.now()) => tickPersonalReminders({ send: send as never, nowMs: () => nowMs })
type Owner = Awaited<ReturnType<typeof readyOwner>>

/** A paying agency, so the existing product-access gate on notifications admits it. */
async function owner(name: string): Promise<Owner> {
  const o = await readyOwner(name)
  await db('agencies').where({ id: o.agencyId }).update({ plan: 'pro', planReason: 'manual:test' })
  return o
}
const jobs = async (o: Owner) =>
  ((await db('notification_jobs').where({ agencyId: o.agencyId, entityType: 'personal_reminder' }).orderBy('id').select('type', 'entityId', 'eventKey', 'payload')) as Record<string, unknown>[]).map((j) => ({ ...j, entityId: Number(j.entityId) }))
const feedOf = (agencyId: number, userId: number) => listNotifications({ agencyId, userId, limit: 50 })
async function deliver() {
  for (let i = 0; i < 3; i++) await runNotificationWorker({ limit: 50 })
}

beforeEach(async () => {
  Object.assign(process.env, ENV)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await enableDelivery()
  await db(T).whereIn('status', ['scheduled', 'claimed', 'dispatching']).update({ status: 'cancelled', cancelReason: 'owner', cancelledAt: new Date(), finalizedAt: new Date() })
  await db(T).where({ status: 'failed', errorScope: 'account' }).update({ finalizedAt: new Date(Date.now() - 2 * 60 * MIN) })
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
  vi.restoreAllMocks()
})
afterAll(async () => {
  await resetControls()
  await db.destroy()
})

describe('definite failure → exactly one owner notice', () => {
  it('a Meta rejection: one `followup.reminder_failed`, in the OWNER’s feed only, without the reminder text', async () => {
    const o = await owner('r9-failed')
    const colleague = await seedUser(o.agencyId, 'ADMIN', 'Colleague')
    const r = await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'rejected', scope: 'recipient', code: '131026', httpStatus: 400 }))
    expect(await jobs(o)).toEqual([expect.objectContaining({ type: 'followup.reminder_failed', entityId: r.id })])
    await deliver()
    const feed = await feedOf(o.agencyId, o.userId)
    expect(feed).toHaveLength(1)
    expect({ ...feed[0], entityId: Number(feed[0].entityId) }).toMatchObject({ type: 'followup.reminder_failed', category: 'followups', title: 'תזכורת לא נשלחה', entityType: 'personal_reminder', entityId: r.id })
    expect(feed[0].body).toMatch(/^לא הצלחנו לשלוח לך בוואטסאפ את התזכורת שביקשת ל-\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}\.$/)
    expect(`${feed[0].title} ${feed[0].body}`).not.toContain('להתקשר')
    expect(`${feed[0].title} ${feed[0].body}`).not.toMatch(/131026|recipient|Meta/)
    expect(feed[0].deepLink).toBe(`/settings/whatsapp_reminders?reminder=${r.id}`)
    expect(await feedOf(o.agencyId, colleague)).toEqual([])
  })

  it('the send gate refusing it (too late) is a definite failure too', async () => {
    const o = await owner('r9-gate')
    const r = await insertReminder(o, 'scheduled', { remindAtMs: Date.now() - 61 * MIN })
    await tick(sends({ kind: 'sent', wamid: 'wamid.never' }))
    expect((await db(T).where({ id: r.id }).first('failureReason')).failureReason).toBe('too_late')
    expect(await jobs(o)).toEqual([expect.objectContaining({ type: 'followup.reminder_failed', entityId: r.id })])
  })

  it('Meta accepting it, then reporting `failed`: one notice, however often the release runs', async () => {
    const o = await owner('r9-meta-failed')
    const r = await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'sent', wamid: `wamid.r9.${Date.now()}` }))
    const wamid = (await db(T).where({ id: r.id }).first('wamid')).wamid as string
    await db('owner_whatsapp_message_status').insert({ wamid, status: 'failed', failedAt: new Date(), errorCode: '131049' })
    await releaseForFailedStatuses()
    await releaseForFailedStatuses()
    expect(await jobs(o)).toEqual([expect.objectContaining({ type: 'followup.reminder_failed', entityId: r.id })])
  })
})

describe('ambiguous outcome → one notice that never claims failure', () => {
  it('a timeout: one `followup.reminder_unconfirmed`, worded as unconfirmed and not resent', async () => {
    const o = await owner('r9-unknown')
    const r = await insertReminder(o, 'scheduled')
    const send = sends({ kind: 'unknown', reason: 'timeout' })
    await tick(send)
    await tick(send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(await jobs(o)).toEqual([expect.objectContaining({ type: 'followup.reminder_unconfirmed', entityId: r.id })])
    await deliver()
    const [n] = await feedOf(o.agencyId, o.userId)
    expect(n.title).toBe('לא ניתן לוודא שתזכורת נשלחה')
    expect(n.body).toContain('ייתכן שהיא הגיעה')
    expect(n.body).toContain('לא תישלח שוב אוטומטית')
    expect(`${n.title} ${n.body}`).not.toContain('לא נשלחה')
  })

  it('a dispatch past its lease: one unconfirmed notice, however many reaper runs', async () => {
    const o = await owner('r9-stale')
    const r = await insertReminder(o, 'dispatching', { dispatchedAt: new Date(Date.now() - 3 * MIN) })
    await reapStaleDispatches(Date.now())
    await reapStaleDispatches(Date.now())
    expect(await jobs(o)).toEqual([expect.objectContaining({ type: 'followup.reminder_unconfirmed', entityId: r.id })])
  })
})

describe('idempotent, owner-scoped and transactional', () => {
  it('re-emitting the same outcome creates nothing new (the event key)', async () => {
    const o = await owner('r9-dupe')
    const r = await insertReminder(o, 'scheduled')
    const row = { id: r.id, agencyId: o.agencyId, userId: o.userId, remindAt: new Date() }
    for (let i = 0; i < 3; i++) await db.transaction((trx) => notifyOwnerReminderNotDelivered(trx, row, 'failed', Date.now()))
    expect(await jobs(o)).toHaveLength(1)
    await deliver()
    await deliver()
    expect(await feedOf(o.agencyId, o.userId)).toHaveLength(1)
  })

  it('another agency never reads it, and a mismatched agency id resolves to nobody', async () => {
    const a = await owner('r9-iso-a')
    const b = await owner('r9-iso-b')
    const r = await insertReminder(a, 'scheduled')
    // A forged job naming A's reminder under B's agency: the owner lookup is (agency, reminder) together.
    await db.transaction((trx) => notifyOwnerReminderNotDelivered(trx, { id: r.id, agencyId: b.agencyId, userId: a.userId, remindAt: new Date() }, 'failed', Date.now()))
    await db.transaction((trx) => notifyOwnerReminderNotDelivered(trx, { id: r.id, agencyId: a.agencyId, userId: a.userId, remindAt: new Date() }, 'failed', Date.now()))
    await deliver()
    expect(await feedOf(a.agencyId, a.userId)).toHaveLength(1)
    expect(await feedOf(b.agencyId, b.userId)).toEqual([])
    expect(await feedOf(b.agencyId, a.userId)).toEqual([])
  })

  it('a suspended owner is notified of nothing', async () => {
    const o = await owner('r9-suspended')
    const r = await insertReminder(o, 'scheduled')
    await db('users').where({ id: o.userId }).update({ suspended: true })
    await db.transaction((trx) => notifyOwnerReminderNotDelivered(trx, { id: r.id, agencyId: o.agencyId, userId: o.userId, remindAt: new Date() }, 'failed', Date.now()))
    expect(await jobs(o)).toEqual([])
  })

  it('the notice commits or rolls back WITH the reminder transition', async () => {
    const o = await owner('r9-trx')
    const r = await insertReminder(o, 'scheduled')
    await expect(
      db.transaction(async (trx) => {
        await notifyOwnerReminderNotDelivered(trx, { id: r.id, agencyId: o.agencyId, userId: o.userId, remindAt: new Date() }, 'failed', Date.now())
        throw new Error('the reminder write failed')
      }),
    ).rejects.toThrow()
    expect(await jobs(o)).toEqual([])
  })

  it('a notification failure never poisons the reminder transition (savepoint)', async () => {
    const o = await owner('r9-savepoint')
    const r = await insertReminder(o, 'dispatching')
    await db.transaction(async (trx) => {
      await trx.raw('ALTER TABLE notification_jobs RENAME TO notification_jobs_x')
      await notifyOwnerReminderNotDelivered(trx, { id: r.id, agencyId: o.agencyId, userId: o.userId, remindAt: new Date() }, 'unknown', Date.now())
      // The transaction is still usable: the failed enqueue rolled back only its savepoint.
      await trx(T).where({ id: r.id }).update({ status: 'unknown', finalizedAt: new Date() })
      await trx.raw('ALTER TABLE notification_jobs_x RENAME TO notification_jobs')
    })
    expect((await db(T).where({ id: r.id }).first('status')).status).toBe('unknown')
  })
})

describe('no notice where none is true', () => {
  it('a successful delivery creates no notice', async () => {
    const o = await owner('r9-sent')
    await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'sent', wamid: `wamid.ok.${Date.now()}` }))
    expect(await jobs(o)).toEqual([])
  })

  it('a cancellation (the owner opted out) is not reported as a failure', async () => {
    const o = await owner('r9-cancel')
    await insertReminder(o, 'scheduled')
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ status: 'opted_out', optedOutAt: new Date(), optOutSource: 'keyword' })
    await tick(sends({ kind: 'sent', wamid: 'wamid.never' }))
    expect(await jobs(o)).toEqual([])
  })

  it('a deferral and a rate-limit retry are still pending: no notice', async () => {
    const o = await owner('r9-pending')
    const r = await insertReminder(o, 'claimed')
    await enableDelivery({ trippedAt: new Date(), trippedReason: 'test' })
    expect((await enterDispatch({ reminderId: r.id, claimToken: r.claimToken, nowMs: Date.now(), exposure: 0 })).result).toBe('deferred')
    await enableDelivery()
    const d = await insertReminder(o, 'dispatching', { attempts: 1 })
    expect(await recordSendOutcome({ reminderId: d.id, claimToken: d.claimToken, outcome: { kind: 'rejected', scope: 'rate_limit', code: '131056', httpStatus: 429 }, nowMs: Date.now() })).toBe('retry')
    expect(await jobs(o)).toEqual([])
  })

  it('with sending off (the production state), nothing is dispatched and nothing is notified', async () => {
    delete process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED
    const o = await owner('r9-off')
    await insertReminder(o, 'scheduled')
    const send = vi.fn()
    expect((await tick(send)).mode).toBe('dry_run')
    expect(send).not.toHaveBeenCalled()
    expect(await jobs(o)).toEqual([])
  })
})

describe('preferences', () => {
  it('the owner’s `followups` channel preferences govern it, exactly as for every other follow-up type', () => {
    const job = { id: 1, agencyId: 1, type: 'followup.reminder_failed', eventKey: 'k', actorUserId: null, entityType: 'personal_reminder', entityId: 7, payload: { remindAtMs: Date.now() }, createdAt: new Date() }
    const context = { handlerByLead: new Map(), adminsByAgency: new Map(), reminderOwnerByKey: new Map([['1:7', 42]]) }
    const base = { job, context, presence: () => 'online', capabilities: { in_app: true, toast: true, web_push: true, email: false } } as never
    const on = planNotification(base) as { plan?: { recipients: { userId: number; channels: string[] }[] } }
    expect(on.plan?.recipients.map((r) => r.userId)).toEqual([42])
    expect(on.plan?.recipients[0].channels.length).toBeGreaterThan(0)
    const off = planNotification({ ...(base as object), preferences: (_u: number, category: string) => (category === 'followups' ? { in_app: false, toast: false, web_push: false, email: false } : undefined) } as never) as { skip?: string }
    expect(off.skip).toBe('no_channels')
  })
})
