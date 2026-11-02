/**
 * Meta `account_update` (lib/whatsapp/accountUpdate.ts) against a real test
 * database: documented disconnecting events mark the matching connections
 * `disconnected` once (one notification per transition), ACCOUNT_RECONNECTED
 * only resets to `unknown`, nothing is deleted or registered, other accounts and
 * agencies are untouched, and duplicate or concurrent delivery changes nothing.
 * Run with --no-file-parallelism against an isolated *_test database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => vi.fn(async (_event: { type: string; agencyId: number }) => ({ enqueued: true })))
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: notify }))

import { db } from '@/config/db'
import { processAccountUpdate } from '@/lib/whatsapp/accountUpdate'

const WABA = '9800000000001'
const OTHER_WABA = '9800000000002'
const PHONES = ['__acct_upd_p1', '__acct_upd_p2', '__acct_upd_other']
let agencyA = 0
let agencyB = 0

const rows = async () =>
  (await db('whatsapp_connections').whereIn('phone_number_id', PHONES).orderBy('phone_number_id').select('phone_number_id', 'waba_id', 'agency_id', 'health_status', 'onboarding_type')) as {
    phone_number_id: string
    waba_id: string
    agency_id: number
    health_status: string
    onboarding_type: string | null
  }[]
const statusOf = async (phone: string) => (await rows()).find((r) => r.phone_number_id === phone)?.health_status

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_account_update_a__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_account_update_b__' }).returning('id')
  agencyA = a.id
  agencyB = b.id
  const [ua] = await db('users').insert({ firstName: 'A', role: 'ADMIN', agencyId: agencyA }).returning('id')
  const [ub] = await db('users').insert({ firstName: 'B', role: 'ADMIN', agencyId: agencyB }).returning('id')
  await db('whatsapp_connections').insert([
    { user_id: ua.id, agency_id: agencyA, phone_number_id: '__acct_upd_p1', access_token: 'x', waba_id: WABA, onboarding_type: 'coexistence' },
    { user_id: ua.id, agency_id: agencyA, phone_number_id: '__acct_upd_p2', access_token: 'x', waba_id: WABA, onboarding_type: 'cloud_api' },
    { user_id: ub.id, agency_id: agencyB, phone_number_id: '__acct_upd_other', access_token: 'x', waba_id: OTHER_WABA, onboarding_type: 'coexistence' },
  ])
})

beforeEach(async () => {
  notify.mockClear()
  await db('whatsapp_connections').whereIn('phone_number_id', PHONES).update({ health_status: 'operational' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterAll(async () => {
  await db('whatsapp_connections').whereIn('phone_number_id', PHONES).del()
  await db('users').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('agencies').whereIn('id', [agencyA, agencyB]).del()
})

describe('disconnecting events', () => {
  it.each(['ACCOUNT_OFFBOARDED', 'ACCOUNT_DELETED'])('%s (entry.id): every connection on that account is marked disconnected, nothing else changes', async (event) => {
    const out = await processAccountUpdate(WABA, { event })
    expect(out).toEqual({ action: 'disconnected', matched: 2, transitioned: 2 })
    const r = await rows()
    expect(r.map((x) => [x.phone_number_id, x.health_status])).toEqual([
      ['__acct_upd_other', 'operational'],
      ['__acct_upd_p1', 'disconnected'],
      ['__acct_upd_p2', 'disconnected'],
    ])
    expect(r).toHaveLength(3) // nothing deleted
    expect(r.find((x) => x.phone_number_id === '__acct_upd_p1')?.onboarding_type).toBe('coexistence') // type untouched
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls.every(([e]) => e.type === 'integration.disconnected' && e.agencyId === agencyA)).toBe(true)
  })

  it('PARTNER_REMOVED uses waba_info.waba_id even when entry.id differs (Meta example shape), with disconnection_info', async () => {
    const out = await processAccountUpdate('2949482758682047', {
      event: 'PARTNER_REMOVED',
      waba_info: { waba_id: WABA, owner_business_id: '2329417887457253' },
      disconnection_info: { reason: 'PRIMARY_INACTIVITY', initiated_by: 'SYSTEM' },
    })
    expect(out).toEqual({ action: 'disconnected', matched: 2, transitioned: 2 })
    expect(await statusOf('__acct_upd_other')).toBe('operational')
  })

  it('duplicate delivery: the second is a no-op and notifies nothing', async () => {
    await processAccountUpdate(WABA, { event: 'ACCOUNT_OFFBOARDED' })
    notify.mockClear()
    const again = await processAccountUpdate(WABA, { event: 'ACCOUNT_OFFBOARDED' })
    expect(again).toEqual({ action: 'disconnected', matched: 2, transitioned: 0 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('concurrent deliveries transition each connection exactly once', async () => {
    const [x, y] = await Promise.all([processAccountUpdate(WABA, { event: 'PARTNER_REMOVED' }), processAccountUpdate(WABA, { event: 'PARTNER_REMOVED' })])
    const total = (x as { transitioned: number }).transitioned + (y as { transitioned: number }).transitioned
    expect(total).toBe(2)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('an account with no SocialCRM connection changes nothing', async () => {
    expect(await processAccountUpdate('9800000009999', { event: 'ACCOUNT_OFFBOARDED' })).toEqual({ action: 'disconnected', matched: 0, transitioned: 0 })
    expect(new Set((await rows()).map((r) => r.health_status))).toEqual(new Set(['operational']))
  })
})

describe('ACCOUNT_RECONNECTED', () => {
  it('resets disconnected connections to unknown (the sweep re-verifies); never claims healthy; no notification', async () => {
    await processAccountUpdate(WABA, { event: 'ACCOUNT_OFFBOARDED' })
    notify.mockClear()
    const out = await processAccountUpdate(WABA, { event: 'ACCOUNT_RECONNECTED' })
    expect(out).toEqual({ action: 'reconnected', matched: 2, reset: 2 })
    expect(await statusOf('__acct_upd_p1')).toBe('unknown')
    expect(notify).not.toHaveBeenCalled()
  })

  it('leaves a connection that is not disconnected alone (duplicate reconnect is a no-op)', async () => {
    const out = await processAccountUpdate(WABA, { event: 'ACCOUNT_RECONNECTED' })
    expect(out).toEqual({ action: 'reconnected', matched: 2, reset: 0 })
    expect(await statusOf('__acct_upd_p1')).toBe('operational')
  })
})

describe('everything else is acknowledged without changes', () => {
  it.each(['PARTNER_ADDED', 'ACCOUNT_VIOLATION', 'ACCOUNT_RESTRICTION', 'MM_LITE_TERMS_SIGNED', 'SOME_FUTURE_EVENT'])('%s: ignored', async (event) => {
    expect(await processAccountUpdate(WABA, { event, waba_info: { waba_id: WABA } })).toEqual({ action: 'ignored', reason: 'unhandled_event' })
    expect(new Set((await rows()).map((r) => r.health_status))).toEqual(new Set(['operational']))
    expect(notify).not.toHaveBeenCalled()
  })

  it.each([
    ['missing event', WABA, {}],
    ['free-text event', WABA, { event: 'drop table; <script>' }],
    ['non-object value', WABA, 'nope'],
  ])('%s: invalid_event', async (_l, entryId, value) => {
    expect(await processAccountUpdate(entryId, value)).toEqual({ action: 'ignored', reason: 'invalid_event' })
  })

  it.each([undefined, '', 'abc', '98000000000x1', { id: WABA }])('unusable account id %s: no_account_id, nothing changed', async (entryId) => {
    expect(await processAccountUpdate(entryId, { event: 'ACCOUNT_OFFBOARDED' })).toEqual({ action: 'ignored', reason: 'no_account_id' })
    expect(new Set((await rows()).map((r) => r.health_status))).toEqual(new Set(['operational']))
  })
})
