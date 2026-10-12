import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings actions and page gate, against a real PostgreSQL. Only the session
 * is injected; every row is read back from the database.
 */

const session = vi.hoisted(() => ({ user: null as null | { id: number; agencyId: number; suspended?: boolean }, access: true }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }))
vi.mock('next/navigation', () => ({ notFound, redirect: vi.fn(), useRouter: vi.fn() }))
vi.mock('@/db/auth', () => ({ getUser: async () => session.user }))
vi.mock('@/lib/requireUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/requireUser')>()
  const requireAgencyUser = async () => {
    if (!session.user) throw new actual.AuthError('no_session')
    return session.user
  }
  return {
    ...actual,
    requireAgencyUser,
    requireProductAccess: async () => {
      const u = await requireAgencyUser()
      if (!session.access) throw new actual.ProductAccessError('subscription-required')
      return u
    },
  }
})

import { db } from '@/config/db'
import { startWhatsappReminderActivation, turnOffWhatsappReminders } from '@/actions/whatsappReminders'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { hashActivationCode } from '@/lib/whatsapp/platform/keys'
import { OWNER_WA_CONSENT } from '@/lib/whatsapp/platform/consentText'

const agencies: number[] = []
let A: number
let EXCLUDED: number
let ua: number
let ub: number
let u158: number
let seq = 0
const T0 = 1_760_000_000

async function agency(name: string, id?: number) {
  const [a] = await db('agencies').insert({ ...(id ? { id } : {}), name, autoResponseEnabled: false, plan: 'pro' }).returning('id')
  agencies.push(Number(a.id))
  return Number(a.id)
}
async function user(agencyId: number) {
  const [u] = await db('users').insert({ firstName: `S${++seq}`, role: 'AGNT', agencyId }).returning('id')
  return Number(u.id)
}
const row = (agencyId: number, userId: number) => db('owner_whatsapp_recipients').where({ agencyId, userId }).first()
const as = (id: number, agencyId: number) => (session.user = { id, agencyId })

beforeAll(async () => {
  A = await agency('__test_owner_settings_a__')
  EXCLUDED = (await db('agencies').where({ id: 158 }).first('id')) ? 158 : await agency('__test_owner_settings_158__', 158)
  ua = await user(A)
  ub = await user(A)
  u158 = await user(EXCLUDED)
})

beforeEach(async () => {
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000001'
  process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER = '972500000000'
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
  session.access = true
  await db('owner_whatsapp_recipients').del()
  await db('platform_whatsapp_inbound').del()
})

afterAll(async () => {
  for (const k of ['PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_WA_ME_NUMBER', 'OWNER_WA_REMINDERS_AGENCY_IDS']) delete process.env[k]
  await db('owner_whatsapp_recipients').del()
  await db('platform_whatsapp_inbound').del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('starting activation', () => {
  it('records consent server-side, bound to the session, and returns the code once (only its hash is stored)', async () => {
    as(ua, A)
    const res = await startWhatsappReminderActivation({ consent: true, userId: ub, agencyId: EXCLUDED } as never)
    if (!('ok' in res)) throw new Error('expected ok')
    expect(res.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(res.waMeHref).toBe(`https://wa.me/972500000000?text=${encodeURIComponent(`הפעלת תזכורות SocialCRM: ${res.code}`)}`)
    const r = await row(A, ua)
    expect(r).toMatchObject({ status: 'pending', consentTextVersion: 'v2', consentSource: 'settings', phoneE164: null })
    expect(r.consentTextVersion).toBe(OWNER_WA_CONSENT.version)
    expect(r.consentAt).toBeTruthy()
    expect(r.activationCodeHash).toBe(hashActivationCode(res.code.replace('-', '')))
    expect(JSON.stringify(r)).not.toContain(res.code.replace('-', ''))
    // The input's userId / agencyId were ignored.
    expect(await row(A, ub)).toBeUndefined()
    expect(await db('owner_whatsapp_recipients').where({ agencyId: EXCLUDED })).toHaveLength(0)
  })

  it('a new consent records the current text version (v2), replacing an older one on the same row', async () => {
    as(ua, A)
    await db('owner_whatsapp_recipients').insert({ agencyId: A, userId: ua, status: 'opted_out', consentAt: db.fn.now(), consentTextVersion: 'v1', consentSource: 'settings' })
    const res = await startWhatsappReminderActivation({ consent: true })
    expect(res).toHaveProperty('ok', true)
    expect(await row(A, ua)).toMatchObject({ status: 'pending', consentTextVersion: 'v2' })
  })

  it('needs the consent box ticked: nothing is written without it', async () => {
    as(ua, A)
    for (const consent of [undefined, false, 'true', 1]) {
      expect(await startWhatsappReminderActivation({ consent })).toHaveProperty('fail', true)
    }
    expect(await row(A, ua)).toBeUndefined()
  })

  it('agency 158, any agency off the allowlist, or no platform number: refused, nothing written', async () => {
    as(u158, EXCLUDED)
    expect(await startWhatsappReminderActivation({ consent: true })).toHaveProperty('fail', true)
    as(ua, A)
    delete process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER
    expect(await startWhatsappReminderActivation({ consent: true })).toHaveProperty('fail', true)
    expect(await db('owner_whatsapp_recipients')).toHaveLength(0)
  })

  it('no session or no product access: refused', async () => {
    session.user = null
    expect(await startWhatsappReminderActivation({ consent: true })).toHaveProperty('fail', true)
    as(ua, A)
    session.access = false
    expect(await startWhatsappReminderActivation({ consent: true })).toHaveProperty('fail', true)
    expect(await db('owner_whatsapp_recipients')).toHaveLength(0)
  })

  it('the full loop: consent, code from the phone, active; while active a new code is refused', async () => {
    as(ua, A)
    const res = await startWhatsappReminderActivation({ consent: true })
    if (!('ok' in res)) throw new Error('expected ok')
    expect(await processPlatformMessage({ id: 'wamid.__set_1', from: '972500000091', timestamp: String(T0), type: 'text', text: { body: `הפעלת תזכורות SocialCRM: ${res.code}` } })).toBe('activated')
    expect((await row(A, ua)).status).toBe('active')
    expect(await startWhatsappReminderActivation({ consent: true })).toEqual({ fail: true, msg: 'התזכורות כבר פעילות' })
  })

  it('a new code replaces the old one: the old code no longer activates', async () => {
    as(ua, A)
    const first = await startWhatsappReminderActivation({ consent: true })
    const second = await startWhatsappReminderActivation({ consent: true })
    if (!('ok' in first) || !('ok' in second)) throw new Error('expected ok')
    expect(await processPlatformMessage({ id: 'wamid.__set_2', from: '972500000092', timestamp: String(T0), type: 'text', text: { body: first.code } })).toBe('activation_rejected')
    expect(await processPlatformMessage({ id: 'wamid.__set_3', from: '972500000092', timestamp: String(T0 + 1), type: 'text', text: { body: second.code } })).toBe('activated')
  })
})

describe('turning reminders off', () => {
  it('opts out only the session user\'s own row, from settings', async () => {
    as(ua, A)
    await startWhatsappReminderActivation({ consent: true })
    as(ub, A)
    await startWhatsappReminderActivation({ consent: true })
    expect(await turnOffWhatsappReminders()).toEqual({ ok: true })
    expect(await row(A, ub)).toMatchObject({ status: 'opted_out', optOutSource: 'settings', activationCodeHash: null })
    expect((await row(A, ua)).status).toBe('pending')
  })

  it('always works, even after the agency leaves the rollout or loses product access', async () => {
    as(ua, A)
    const res = await startWhatsappReminderActivation({ consent: true })
    if (!('ok' in res)) throw new Error('expected ok')
    await processPlatformMessage({ id: 'wamid.__set_4', from: '972500000093', timestamp: String(T0), type: 'text', text: { body: res.code } })
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = ''
    session.access = false
    expect(await turnOffWhatsappReminders()).toEqual({ ok: true })
    expect((await row(A, ua)).status).toBe('opted_out')
  })

  it('only a new consent re-enables, and it needs a new code from the phone', async () => {
    as(ua, A)
    await startWhatsappReminderActivation({ consent: true })
    await turnOffWhatsappReminders()
    const res = await startWhatsappReminderActivation({ consent: true })
    if (!('ok' in res)) throw new Error('expected ok')
    expect((await row(A, ua)).status).toBe('pending')
    expect(await processPlatformMessage({ id: 'wamid.__set_5', from: '972500000094', timestamp: String(T0), type: 'text', text: { body: res.code } })).toBe('activated')
  })
})

describe('the settings page gate', () => {
  it('404s outside the rollout (agency 158 included) and renders inside it', async () => {
    const { default: page } = await import('@/app/(app)/settings/(user_settings)/whatsapp_reminders/page')
    as(u158, EXCLUDED)
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND')
    as(ua, A)
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = ''
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND')
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
    await expect(page()).resolves.toBeTruthy()
  })
})
