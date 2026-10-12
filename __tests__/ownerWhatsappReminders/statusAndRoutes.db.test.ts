import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { processPlatformChanges } from '@/lib/whatsapp/platform/inbound'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'
import { MIN, ago, agency, cleanup, clearEnv, conversation, escalate, mockGraph, recipient, resetBetweenTests, setLiveEnv, user } from './reminderFixtures'

/** Delivery statuses from the platform webhook, the migration, and the cron route. */
const MIGRATION = require(path.join(process.cwd(), 'migrations/20261013120000_owner_whatsapp_reminders.cjs'))
let A: number

beforeAll(async () => {
  A = await agency('__owr_status_a__')
})
beforeEach(async () => {
  await resetBetweenTests()
  setLiveEnv([A])
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  delete process.env.CRON_SECRET
  await cleanup()
})

const statusChange = (wamid: string, status: string, ts: number, errors?: unknown[]) => ({
  field: 'messages',
  value: { metadata: { phone_number_id: '1000000000001' }, statuses: [{ id: wamid, status, timestamp: String(ts), recipient_id: 'x', ...(errors ? { errors } : {}) }] },
})
const statusOf = (wamid: string) => db('owner_whatsapp_message_status').where({ wamid }).first()

describe('delivery statuses for reminders', () => {
  it('are recorded by message id, joinable to the delivery, and only move forward', async () => {
    await recipient(A, await user(A), '972500000301')
    const c = await conversation(A, { lead: false })
    await escalate(c, ago(121 * MIN))
    mockGraph(() => new Response(JSON.stringify({ messages: [{ id: 'wamid.REM_1' }] }), { status: 200 }))
    await tickOwnerWhatsappReminders()
    const t = 1_760_100_000
    expect((await processPlatformChanges([statusChange('wamid.REM_1', 'read', t + 20)])).ok).toBe(true)
    await processPlatformChanges([statusChange('wamid.REM_1', 'delivered', t + 10)])
    await processPlatformChanges([statusChange('wamid.REM_1', 'sent', t)])
    const s = await statusOf('wamid.REM_1')
    expect(s.status).toBe('read')
    expect([s.sentAt, s.deliveredAt, s.readAt].map((d: Date) => d.getTime() / 1000)).toEqual([t, t + 10, t + 20])
    const joined = await db('owner_whatsapp_reminder_deliveries as d').join('owner_whatsapp_message_status as s', 's.wamid', 'd.wamid').first('s.status')
    expect(joined.status).toBe('read')
  })

  it('a status that arrives before the send result is kept; failed is terminal and keeps its code', async () => {
    await processPlatformChanges([statusChange('wamid.EARLY', 'sent', 1_760_100_000)])
    expect((await statusOf('wamid.EARLY')).status).toBe('sent')
    await processPlatformChanges([statusChange('wamid.EARLY', 'failed', 1_760_100_005, [{ code: 131026 }])])
    await processPlatformChanges([statusChange('wamid.EARLY', 'read', 1_760_100_009)])
    expect(await statusOf('wamid.EARLY')).toMatchObject({ status: 'failed', errorCode: '131026' })
  })

  it('a redelivered status changes nothing', async () => {
    await processPlatformChanges([statusChange('wamid.DUP', 'delivered', 1_760_100_000)])
    const before = await statusOf('wamid.DUP')
    await processPlatformChanges([statusChange('wamid.DUP', 'delivered', 1_760_100_099)])
    expect((await statusOf('wamid.DUP')).deliveredAt).toEqual(before.deliveredAt)
  })
})

describe('migration', () => {
  const count = async () =>
    (await db.raw(`SELECT count(*)::int AS n FROM pg_tables WHERE tablename IN ('owner_whatsapp_reminders','owner_whatsapp_reminder_deliveries','owner_whatsapp_message_status')`)).rows[0].n
  it('creates three tables and is reversible (down, up)', async () => {
    expect(await count()).toBe(3)
    await MIGRATION.down(db)
    expect(await count()).toBe(0)
    await MIGRATION.up(db)
    expect(await count()).toBe(3)
  })
})

describe('cron route', () => {
  const call = async (headers: Record<string, string>) => {
    const { GET } = await import('@/app/api/cron/owner-wa-reminders/route')
    return GET(new Request('https://getsocialcrm.com/api/cron/owner-wa-reminders', { headers }) as never)
  }
  it('requires CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'cron-secret-test'
    expect((await call({})).status).toBe(403)
    expect((await call({ authorization: 'Bearer wrong' })).status).toBe(403)
  })
  it('with nothing configured it answers disabled and sends nothing', async () => {
    process.env.CRON_SECRET = 'cron-secret-test'
    clearEnv()
    const g = mockGraph()
    const res = await call({ authorization: 'Bearer cron-secret-test' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, mode: 'disabled' })
    expect(g.calls).toEqual([])
  })
})

describe('readiness route', () => {
  it('requires CRON_SECRET and is GET only', async () => {
    process.env.CRON_SECRET = 'cron-secret-test'
    const mod = await import('@/app/api/internal/owner-wa/readiness/route')
    expect(Object.keys(mod).filter((k) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(k))).toEqual([])
    const res = await mod.GET(new Request('https://getsocialcrm.com/api/internal/owner-wa/readiness') as never)
    expect(res.status).toBe(403)
  })
})
