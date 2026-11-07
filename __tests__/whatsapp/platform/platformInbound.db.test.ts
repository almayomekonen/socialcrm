import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { startOwnActivation } from '@/db/ownerWhatsappRecipients'
import { hashActivationCode, hashPlatformSender } from '@/lib/whatsapp/platform/keys'
import {
  MAX_REJECTED_ACTIVATIONS_PER_HOUR,
  PLATFORM_SENDER_LOCK_NAMESPACE,
  processPlatformChanges,
  processPlatformMessage,
} from '@/lib/whatsapp/platform/inbound'

/**
 * Platform inbound against a real PostgreSQL: dedup, opt-out, activation,
 * ordering, rate limiting, rollback, isolation. Nothing here may send: fetch is
 * watched for the whole file.
 *
 * NOTE: over the 250-line soft limit on purpose. It is one fixture set and one
 * state machine (dedup, opt-out, activation, ordering, rate limit, rollback);
 * splitting it would duplicate the fixtures without making any case clearer.
 */

const MIGRATION = require(path.join(process.cwd(), 'migrations/20261012120000_owner_whatsapp_consent.cjs'))
/** Depends on this migration's tables (foreign key, added column): rolled back first, re-applied last. */
const DEPENDENT = require(path.join(process.cwd(), 'migrations/20261107130000_owner_personal_reminders.cjs'))
const fetchSpy = vi.spyOn(globalThis, 'fetch')
const agencies: number[] = []
let A: number
let B: number
let EXCLUDED: number
let seq = 0

const PHONE = '972500000071'
const OTHER_PHONE = '972500000072'
const T0 = 1_760_000_000

async function agency(name: string, id?: number): Promise<number> {
  const [a] = await db('agencies').insert({ ...(id ? { id } : {}), name, autoResponseEnabled: false, plan: 'pro' }).returning('id')
  agencies.push(Number(a.id))
  return Number(a.id)
}
async function user(agencyId: number, extra: Record<string, unknown> = {}): Promise<number> {
  const [u] = await db('users').insert({ firstName: `O${++seq}`, role: 'ADMIN', agencyId, ...extra }).returning('id')
  return Number(u.id)
}
async function pending(agencyId: number, userId: number, code: string, ttlMs = 15 * 60_000) {
  await startOwnActivation({ agencyId, userId, codeHash: hashActivationCode(code), expiresAt: new Date(Date.now() + ttlMs), consentTextVersion: 'v2' })
}
const recipient = (agencyId: number, userId: number) => db('owner_whatsapp_recipients').where({ agencyId, userId }).first()
const msg = (body: string, opts: { from?: string | null; ts?: number; id?: string; type?: string } = {}) => ({
  id: opts.id ?? `wamid.__plat_${++seq}`,
  ...(opts.from === null ? {} : { from: opts.from ?? PHONE }),
  timestamp: String(opts.ts ?? T0 + seq),
  type: opts.type ?? 'text',
  text: { body },
})
const inboundRows = (wamid: string) => db('platform_whatsapp_inbound').where({ wamid })

beforeAll(async () => {
  A = await agency('__test_owner_wa_a__')
  B = await agency('__test_owner_wa_b__')
  // Agency 158 exists only as a synthetic row in this local test database, to
  // prove the allowlist excludes it. Nothing here reaches any real agency.
  EXCLUDED = (await db('agencies').where({ id: 158 }).first('id')) ? 158 : await agency('__test_owner_wa_158__', 158)
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B}`
})

beforeEach(async () => {
  await db('owner_whatsapp_recipients').del()
  await db('platform_whatsapp_inbound').del()
  fetchSpy.mockClear()
})

afterEach(() => expect(fetchSpy).not.toHaveBeenCalled())

afterAll(async () => {
  delete process.env.OWNER_WA_REMINDERS_AGENCY_IDS
  await db('owner_whatsapp_recipients').del()
  await db('platform_whatsapp_inbound').del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
  fetchSpy.mockRestore()
})

describe('migration', () => {
  const exists = async () =>
    (await db.raw(`SELECT count(*)::int AS n FROM pg_tables WHERE tablename IN ('owner_whatsapp_recipients','platform_whatsapp_inbound')`)).rows[0].n

  it('creates two tables and is reversible (down, up)', async () => {
    expect(await exists()).toBe(2)
    await DEPENDENT.down(db)
    await MIGRATION.down(db)
    expect(await exists()).toBe(0)
    await MIGRATION.up(db)
    await DEPENDENT.up(db)
    expect(await exists()).toBe(2)
  })

  it('an active row must carry a verified number', async () => {
    const u = await user(A)
    await expect(
      db('owner_whatsapp_recipients').insert({ agencyId: A, userId: u, status: 'active', consentAt: db.fn.now(), consentTextVersion: 'v2', consentSource: 'settings' }),
    ).rejects.toThrow()
  })
})

describe('activation proves the number', () => {
  it('a live code from the phone activates the row and binds the number Meta reported', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2345')
    expect(await processPlatformMessage(msg('הפעלת תזכורות SocialCRM: ABCD-2345'))).toBe('activated')
    const row = await recipient(A, u)
    expect(row).toMatchObject({ status: 'active', phoneE164: `+${PHONE}`, activationCodeHash: null, activationExpiresAt: null })
    expect(row.verifiedAt).toBeTruthy()
  })

  it('the code works once: a reused code and a redelivered message change nothing', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2346')
    const first = msg('ABCD-2346')
    expect(await processPlatformMessage(first)).toBe('activated')
    expect(await processPlatformMessage(first)).toBe('duplicate')
    expect(await processPlatformMessage(msg('ABCD-2346', { from: OTHER_PHONE }))).toBe('activation_rejected')
    expect((await recipient(A, u)).phoneE164).toBe(`+${PHONE}`)
    expect(await inboundRows(first.id)).toHaveLength(1)
  })

  it('wrong and expired codes are rejected', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2347', -1000)
    expect(await processPlatformMessage(msg('ABCD-2347'))).toBe('activation_rejected')
    expect(await processPlatformMessage(msg('ZZZZ-2222'))).toBe('activation_rejected')
    expect((await recipient(A, u)).status).toBe('pending')
  })

  it('agency 158 (and any agency off the allowlist) can never be activated by a webhook', async () => {
    const u = await user(EXCLUDED)
    await pending(EXCLUDED, u, 'ABCD2348')
    expect(await processPlatformMessage(msg('ABCD-2348'))).toBe('activation_rejected')
    expect((await recipient(EXCLUDED, u)).status).toBe('pending')
  })

  it('a code is bound to its own agency and user: another agency\'s pending row is untouched', async () => {
    const ua = await user(A)
    const ub = await user(B)
    await pending(A, ua, 'ABCD2349')
    await pending(B, ub, 'ABCD2352')
    expect(await processPlatformMessage(msg('ABCD-2349'))).toBe('activated')
    expect((await recipient(A, ua)).status).toBe('active')
    expect((await recipient(B, ub)).status).toBe('pending')
  })

  it('a suspended user, or one moved to another agency, is not activated', async () => {
    const s = await user(A, { suspended: true })
    await pending(A, s, 'ABCD2353')
    expect(await processPlatformMessage(msg('ABCD-2353'))).toBe('activation_rejected')
    const m = await user(A)
    await pending(A, m, 'ABCD2354')
    await db('users').where({ id: m }).update({ agencyId: B })
    expect(await processPlatformMessage(msg('ABCD-2354'))).toBe('activation_rejected')
  })

  it('without a sender number (username users) or Meta\'s send time, nothing is activated', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2355')
    expect(await processPlatformMessage(msg('ABCD-2355', { from: null }))).toBe('ignored')
    expect(await processPlatformMessage({ ...msg('ABCD-2355'), timestamp: undefined })).toBe('ignored')
    expect((await recipient(A, u)).status).toBe('pending')
  })
})

describe('opt-out', () => {
  it('a keyword opts out every row with that number, in every agency, with no message sent', async () => {
    const ua = await user(A)
    const ub = await user(B)
    await pending(A, ua, 'ABCD2356')
    await pending(B, ub, 'ABCD2357')
    await processPlatformMessage(msg('ABCD-2356', { ts: T0 }))
    await processPlatformMessage(msg('ABCD-2357', { ts: T0 + 1 }))
    expect(await processPlatformMessage(msg('הסר', { ts: T0 + 10 }))).toBe('opted_out')
    for (const [a, u] of [[A, ua], [B, ub]]) expect(await recipient(a, u)).toMatchObject({ status: 'opted_out', optOutSource: 'keyword' })
  })

  it('a redelivered opt-out is a no-op, and no webhook ever reactivates an opted-out row', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2358')
    const activation = msg('ABCD-2358', { ts: T0 })
    await processPlatformMessage(activation)
    const stop = msg('STOP', { ts: T0 + 5 })
    expect(await processPlatformMessage(stop)).toBe('opted_out')
    expect(await processPlatformMessage(stop)).toBe('duplicate')
    expect(await processPlatformMessage(activation)).toBe('duplicate')
    expect(await processPlatformMessage(msg('ABCD-2358', { ts: T0 + 20 }))).toBe('activation_rejected')
    expect((await recipient(A, u)).status).toBe('opted_out')
  })

  it('a pending row is cancelled too (its code is cleared)', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2359')
    await processPlatformMessage(msg('ABCD-2359', { ts: T0 }))
    await processPlatformMessage(msg('עצור', { ts: T0 + 1 }))
    // A new consent in settings makes it pending again, keeping the last verified number.
    await pending(A, u, 'ABCD2362')
    expect(await processPlatformMessage(msg('הסרה', { ts: T0 + 2 }))).toBe('opted_out')
    expect(await recipient(A, u)).toMatchObject({ status: 'opted_out', activationCodeHash: null })
  })

  it('an unknown number opting out changes nothing else, and is still recorded', async () => {
    const m = msg('הסר', { from: OTHER_PHONE })
    expect(await processPlatformMessage(m)).toBe('opted_out')
    expect((await inboundRows(m.id))[0]).toMatchObject({ kind: 'opt_out', fromHash: hashPlatformSender(OTHER_PHONE) })
  })
})

describe('ordering by Meta send time, not arrival', () => {
  it('a later opt-out that arrives first blocks the earlier activation', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2363')
    await processPlatformMessage(msg('הסר', { ts: T0 + 10 }))
    expect(await processPlatformMessage(msg('ABCD-2363', { ts: T0 + 5 }))).toBe('activation_rejected')
    expect((await recipient(A, u)).status).toBe('pending')
  })

  it('a tie goes to the opt-out, both ways round', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2364')
    await processPlatformMessage(msg('הסר', { ts: T0 + 10 }))
    expect(await processPlatformMessage(msg('ABCD-2364', { ts: T0 + 10 }))).toBe('activation_rejected')
    const v = await user(A)
    await pending(A, v, 'ABCD2365')
    await processPlatformMessage(msg('ABCD-2365', { from: OTHER_PHONE, ts: T0 + 20 }))
    await processPlatformMessage(msg('STOP', { from: OTHER_PHONE, ts: T0 + 20 }))
    expect((await recipient(A, v)).status).toBe('opted_out')
  })

  it('an earlier opt-out that arrives late leaves a later activation in place', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2366')
    await processPlatformMessage(msg('ABCD-2366', { ts: T0 + 30 }))
    expect(await processPlatformMessage(msg('הסר', { ts: T0 + 20 }))).toBe('opted_out')
    expect((await recipient(A, u)).status).toBe('active')
  })
})

describe('rate limiting, atomically per sender', () => {
  it(`after ${MAX_REJECTED_ACTIVATIONS_PER_HOUR} rejected attempts in an hour, even the right code is refused`, async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2367')
    for (let i = 0; i < MAX_REJECTED_ACTIVATIONS_PER_HOUR; i++) {
      expect(await processPlatformMessage(msg('WXYZ-2222'))).toBe('activation_rejected')
    }
    expect(await processPlatformMessage(msg('ABCD-2367'))).toBe('activation_rejected')
    expect((await recipient(A, u)).status).toBe('pending')
    // Another number is not affected.
    const v = await user(A)
    await pending(A, v, 'ABCD2368')
    expect(await processPlatformMessage(msg('ABCD-2368', { from: OTHER_PHONE }))).toBe('activated')
  })

  it('concurrent attempts from one sender never exceed the limit', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => processPlatformMessage(msg('WXYZ-3333'))))
    expect(results.every((r) => r === 'activation_rejected')).toBe(true)
    const u = await user(A)
    await pending(A, u, 'ABCD2369')
    expect(await processPlatformMessage(msg('ABCD-2369'))).toBe('activation_rejected')
  })

  it('each message waits on the per-sender advisory lock (namespace is its own)', async () => {
    const hold = await db.transaction()
    await hold.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [hashPlatformSender(PHONE), PLATFORM_SENDER_LOCK_NAMESPACE])
    let done = false
    const p = processPlatformMessage(msg('הסר')).then((r) => ((done = true), r))
    await new Promise((r) => setTimeout(r, 300))
    expect(done).toBe(false)
    await hold.commit()
    expect(await p).toBe('opted_out')
  })
})

describe('failure and isolation', () => {
  it('a failure rolls back the whole message, including its dedup row, so the retry is processed once', async () => {
    const u = await user(A)
    await pending(A, u, 'ABCD2372')
    await processPlatformMessage(msg('ABCD-2372', { ts: T0 }))
    await db.raw(`CREATE OR REPLACE FUNCTION __fail_owner_wa() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced'; END $$ LANGUAGE plpgsql`)
    await db.raw(`CREATE TRIGGER __fail_owner_wa BEFORE UPDATE ON owner_whatsapp_recipients FOR EACH ROW EXECUTE FUNCTION __fail_owner_wa()`)
    const stop = msg('הסר', { ts: T0 + 1 })
    try {
      const result = await processPlatformChanges([{ field: 'messages', value: { messages: [stop] } }])
      expect(result).toMatchObject({ ok: false, failed: 1 })
      expect(await inboundRows(stop.id)).toHaveLength(0)
      expect((await recipient(A, u)).status).toBe('active')
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS __fail_owner_wa ON owner_whatsapp_recipients`)
      await db.raw(`DROP FUNCTION IF EXISTS __fail_owner_wa()`)
    }
    expect(await processPlatformChanges([{ field: 'messages', value: { messages: [stop] } }])).toMatchObject({ ok: true, outcomes: ['opted_out'] })
    expect(await processPlatformChanges([{ field: 'messages', value: { messages: [stop] } }])).toMatchObject({ ok: true, outcomes: ['duplicate'] })
    expect((await recipient(A, u)).status).toBe('opted_out')
  })

  it('statuses and other fields are ignored; other messages are recorded without content', async () => {
    const m = msg('שלום, מה המחיר?')
    const result = await processPlatformChanges([
      { field: 'messages', value: { statuses: [{ id: 'wamid.x', status: 'delivered' }], messages: [m, { ...msg('x'), type: 'image' }] } },
      { field: 'smb_message_echoes', value: { message_echoes: [{ id: 'e' }] } },
    ])
    expect(result.outcomes).toEqual(['ignored', 'ignored'])
    const row = (await inboundRows(m.id))[0]
    expect(row.kind).toBe('other')
    expect(JSON.stringify(row)).not.toContain('המחיר')
    expect(JSON.stringify(row)).not.toContain(PHONE)
  })

  it('never writes to the agency pipeline', async () => {
    const tables = ['inbox_conversations', 'inbox_messages', 'clients', 'auto_response_jobs', 'notifications', 'notification_jobs', 'tasks']
    const count = async () => Promise.all(tables.map(async (t) => Number((await db(t).count<{ c: string }>('* as c').first())?.c ?? 0)))
    const before = await count()
    const u = await user(A)
    await pending(A, u, 'ABCD2373')
    await processPlatformChanges([{ field: 'messages', value: { messages: [msg('ABCD-2373'), msg('תודה'), msg('הסר')] } }])
    expect(await count()).toEqual(before)
  })
})
