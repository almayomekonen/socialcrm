import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { startOwnActivation } from '@/db/ownerWhatsappRecipients'
import { hashActivationCode } from '@/lib/whatsapp/platform/keys'
import {
  CUSTOMER, OWNER, PLATFORM, PN_A, SECRET, agencyEcho, agencyHistory, agencyInbound, agencySideEffects as sideEffectsOf,
  agencyStatus, agencyTemplateStatus, delivery, platformEcho, platformMessage, platformStatus, signed,
} from './mixedBatchFixtures'

/**
 * The webhook route with REAL agency handling and REAL platform handling, on a
 * real PostgreSQL. Two things are made to fail on demand, each by wrapping the
 * real implementation: the platform save (`processPlatformChanges`) and the
 * agency Coexistence handler (`processCoexistenceWebhook`).
 *
 * The Gate 1 rule under test:
 *   - agency first, then platform;
 *   - platform save fails after a successful agency part that is safe to repeat
 *     (messages): 500, and the redelivery adds no agency side effect;
 *   - platform save fails after a successful agency part that is NOT proven safe
 *     to repeat (Coexistence, template lifecycle): 200, logged as NOT saved;
 *   - the agency part fails: its own answer stands; nothing is duplicated.
 *
 * NOTE: over the 250-line soft limit on purpose. Every case shares the signed
 * delivery builders and the two failure switches; one file keeps the whole
 * Gate 1 rule readable in one place.
 */

const platformFail = vi.hoisted(() => ({ next: 0 }))
vi.mock('@/lib/whatsapp/platform/inbound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/platform/inbound')>()
  return {
    ...actual,
    processPlatformChanges: vi.fn(async (changes: Parameters<typeof actual.processPlatformChanges>[0]) => {
      if (platformFail.next > 0) {
        platformFail.next--
        return { ok: false, failed: 1, outcomes: [], guidance: [] }
      }
      return actual.processPlatformChanges(changes)
    }),
  }
})
const coexistence = vi.hoisted(() => ({ mode: 'real' as 'real' | 'fail' | 'throw', calls: [] as string[] }))
vi.mock('@/lib/whatsapp/coexistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/coexistence')>()
  return {
    ...actual,
    processCoexistenceWebhook: vi.fn(async (field: string, value: unknown) => {
      coexistence.calls.push(field)
      if (coexistence.mode === 'fail') return { ok: false, field, reason: 'history_durable_write_failed' }
      if (coexistence.mode === 'throw') throw new Error('forced agency failure')
      return actual.processCoexistenceWebhook(field, value)
    }),
  }
})
vi.mock('@/lib/inbox/autoresponse/kickWorker', () => ({ runAutoResponseKick: vi.fn() }))
// after(): run the post-response work (the durable receipt drain) and let post() await it.
const afterWork = vi.hoisted(() => [] as Promise<unknown>[])
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => void afterWork.push(Promise.resolve().then(fn)) }
})
// The three agency handlers, wrapped so their calls are counted while the REAL
// implementation still runs.
const agencyHandlers = vi.hoisted(() => ({ inbound: 0, statuses: 0, templates: 0 }))
vi.mock('@/lib/whatsapp/handleInboundWebhookMessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/handleInboundWebhookMessage')>()
  return { ...actual, handleInboundWebhookMessage: vi.fn(async (...a: Parameters<typeof actual.handleInboundWebhookMessage>) => (agencyHandlers.inbound++, actual.handleInboundWebhookMessage(...a))) }
})
vi.mock('@/lib/inbox/ingestWhatsappStatuses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inbox/ingestWhatsappStatuses')>()
  return { ...actual, ingestWhatsappStatuses: vi.fn(async (...a: Parameters<typeof actual.ingestWhatsappStatuses>) => (agencyHandlers.statuses++, actual.ingestWhatsappStatuses(...a))) }
})
vi.mock('@/lib/whatsapp/templates/ingestStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/templates/ingestStatus')>()
  return { ...actual, ingestTemplateStatusUpdate: vi.fn(async (...a: Parameters<typeof actual.ingestTemplateStatusUpdate>) => (agencyHandlers.templates++, actual.ingestTemplateStatusUpdate(...a))) }
})

const fetchSpy = vi.spyOn(globalThis, 'fetch')
const errorSpy = vi.spyOn(console, 'error')
let agencyA: number
let ownerUser: number
let seq = 0

const { POST } = await import('@/app/api/webhooks/whatsapp/route')

const post = async (body: unknown) => {
  const res = await POST(signed(body) as never)
  await Promise.all(afterWork.splice(0))
  return res
}
const agencySideEffects = () => sideEffectsOf(agencyA)
const platformRows = (wamid: string) => db('platform_whatsapp_inbound').where({ wamid })
const ownerRow = () => db('owner_whatsapp_recipients').where({ agencyId: agencyA, userId: ownerUser }).first()

beforeAll(async () => {
  process.env.META_APP_SECRET = SECRET
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  const [a] = await db('agencies').insert({ name: '__test_mixed_batch__', autoResponseEnabled: false, plan: 'pro' }).returning('id')
  agencyA = Number(a.id)
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(agencyA)
  const [u] = await db('users').insert({ firstName: 'Mixed', role: 'ADMIN', agencyId: agencyA }).returning('id')
  ownerUser = Number(u.id)
  await db('whatsapp_connections').insert({ user_id: ownerUser, agency_id: agencyA, phone_number_id: PN_A, access_token: 'x' })
})

beforeEach(async () => {
  platformFail.next = 0
  coexistence.mode = 'real'
  coexistence.calls = []
  agencyHandlers.inbound = agencyHandlers.statuses = agencyHandlers.templates = 0
  fetchSpy.mockClear()
  errorSpy.mockClear()
  await db('owner_whatsapp_recipients').where({ agencyId: agencyA }).del()
  await startOwnActivation({ agencyId: agencyA, userId: ownerUser, codeHash: hashActivationCode('MNPQ2345'), expiresAt: new Date(Date.now() + 600_000), consentTextVersion: 'v2' })
})

afterAll(async () => {
  for (const k of ['META_APP_SECRET', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'OWNER_WA_REMINDERS_AGENCY_IDS']) delete process.env[k]
  for (const t of ['notification_jobs', 'notifications', 'analytics_events', 'auto_response_jobs', 'conversation_analysis_jobs', 'conversation_ai_state', 'tasks', 'inbox_messages', 'inbox_participants', 'inbox_conversations']) {
    const cols = await db(t).columnInfo().catch(() => ({}))
    if ('agencyId' in cols) await db(t).where({ agencyId: agencyA }).del()
  }
  await db('clients').where({ agencyId: agencyA }).del()
  await db('owner_whatsapp_recipients').where({ agencyId: agencyA }).del()
  await db('platform_whatsapp_inbound').del()
  await db('whatsapp_webhook_events').where({ agencyId: agencyA }).del()
  await db('whatsapp_connections').where({ agency_id: agencyA }).del()
  await db('users').where({ agencyId: agencyA }).del()
  await db('agencies').where({ id: agencyA }).del()
  fetchSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('platform save fails after a successful agency part that is safe to repeat (messages)', () => {
  it('answers 500; the redelivery saves the platform change once and adds no agency side effect', async () => {
    const body = delivery(agencyInbound(`wamid.__mixed_in_${++seq}`), platformMessage(`wamid.__mixed_pl_${seq}`, 'MNPQ-2345'))
    platformFail.next = 1

    const first = await post(body)
    expect(first.status).toBe(500)
    const afterFirst = await agencySideEffects()
    expect(afterFirst.inbox_messages).toBeGreaterThan(0)
    expect((await ownerRow()).status).toBe('pending')
    expect(await platformRows(`wamid.__mixed_pl_${seq}`)).toHaveLength(0)

    const retry = await post(body)
    expect(retry.status).toBe(200)
    expect(await agencySideEffects()).toEqual(afterFirst)
    expect((await ownerRow()).status).toBe('active')
    expect(await platformRows(`wamid.__mixed_pl_${seq}`)).toHaveLength(1)

    const again = await post(body)
    expect(again.status).toBe(200)
    expect(await agencySideEffects()).toEqual(afterFirst)
    expect(await platformRows(`wamid.__mixed_pl_${seq}`)).toHaveLength(1)
  })
})

describe('platform save fails after a successful agency part that is safe to repeat (delivery statuses)', () => {
  it('answers 500; the redelivery leaves the status where it was and adds no agency side effect', async () => {
    // An outbound message of agency A that Meta reports on (as the composer would have stored it).
    const inId = `wamid.__mixed_in_${++seq}`
    expect((await post(delivery(agencyInbound(inId)))).status).toBe(200)
    const { id: _id, ...src } = await db('inbox_messages').where({ agencyId: agencyA, externalId: inId }).first()
    const outId = `wamid.__mixed_out_${seq}`
    await db('inbox_messages').insert({ ...src, sequence: Number(src.sequence) + 1, externalId: outId, direction: 'outbound', status: 'sent' })
    const platformId = `wamid.__mixed_pl_${seq}`
    const body = delivery(agencyStatus(outId, 'delivered'), platformMessage(platformId, 'MNPQ-2345', 1_760_009_000))
    platformFail.next = 1

    const first = await post(body)
    expect(first.status).toBe(500)
    expect(agencyHandlers.statuses).toBe(1)
    expect((await db('inbox_messages').where({ externalId: outId }).first('status')).status).toBe('delivered')
    const afterFirst = await agencySideEffects()
    expect(await platformRows(platformId)).toHaveLength(0)

    const retry = await post(body)
    expect(retry.status).toBe(200)
    // The redelivered status is absorbed by its durable receipt and never applied again.
    expect(agencyHandlers.statuses).toBe(1)
    expect((await db('inbox_messages').where({ externalId: outId }).first('status')).status).toBe('delivered')
    expect(await agencySideEffects()).toEqual(afterFirst)
    expect(await platformRows(platformId)).toHaveLength(1)
    expect((await ownerRow()).status).toBe('active')
  })
})

describe('platform save fails after a successful agency template-status change (NOT proven safe to repeat)', () => {
  it('answers 200, runs the template handler once, logs the platform event as NOT saved', async () => {
    const platformId = `wamid.__mixed_pl_${++seq}`
    const before = await agencySideEffects()
    platformFail.next = 1

    const res = await post(delivery(agencyTemplateStatus(), platformMessage(platformId, 'MNPQ-2345')))
    expect(res.status).toBe(200)
    expect(agencyHandlers.templates).toBe(1)
    expect(await platformRows(platformId)).toHaveLength(0)
    expect((await ownerRow()).status).toBe('pending')
    expect(await agencySideEffects()).toEqual(before)
    const logged = errorSpy.mock.calls.find((c) => String(c[0]).includes('[WhatsappWebhook][platform] event NOT saved'))
    expect(logged?.[1]).toEqual({ unsavedMessages: 1, agencyFields: ['message_template_status_update'] })
  })
})

describe('platform save fails after a successful agency part NOT proven safe to repeat (Coexistence)', () => {
  it('answers 200, logs the event as NOT saved without content or numbers, and does not claim it was saved', async () => {
    const echoId = `wamid.__mixed_echo_${++seq}`
    const platformId = `wamid.__mixed_pl_${seq}`
    platformFail.next = 1

    const res = await post(delivery(agencyEcho(echoId), platformMessage(platformId, 'הסר')))
    expect(res.status).toBe(200)
    // Echoes are durable events now, applied by the echo ingester, not the Coexistence dispatcher.
    expect(coexistence.calls).toEqual([])
    expect(await db('inbox_messages').where({ agencyId: agencyA, externalId: echoId })).toHaveLength(1)
    expect(await platformRows(platformId)).toHaveLength(0)

    const logged = errorSpy.mock.calls.find((c) => String(c[0]).includes('[WhatsappWebhook][platform] event NOT saved'))
    expect(logged).toBeTruthy()
    expect(logged?.[1]).toEqual({ unsavedMessages: 1, agencyFields: ['smb_message_echoes'] })
    const text = JSON.stringify(logged)
    for (const secret of [OWNER, CUSTOMER, 'הסר', platformId, echoId, 'תשובה']) expect(text).not.toContain(secret)
  })
})

describe('the agency part fails', () => {
  it('a refused Coexistence delivery keeps its 503; the platform change is saved once across the redelivery', async () => {
    const platformId = `wamid.__mixed_pl_${++seq}`
    const body = delivery(agencyHistory(), platformMessage(platformId, 'MNPQ-2345'))
    const before = await agencySideEffects()
    coexistence.mode = 'fail'

    const first = await post(body)
    expect(first.status).toBe(503)
    expect((await ownerRow()).status).toBe('active')
    expect(await platformRows(platformId)).toHaveLength(1)

    coexistence.mode = 'real'
    const retry = await post(body)
    expect(retry.status).toBe(200)
    expect(coexistence.calls).toEqual(['history', 'history'])
    expect(await platformRows(platformId)).toHaveLength(1)
    expect((await ownerRow()).status).toBe('active')
    expect(await agencySideEffects()).toEqual(before)
  })

  it('an exception in the agency path propagates as before; the platform change is saved on the redelivery', async () => {
    const platformId = `wamid.__mixed_pl_${++seq}`
    const body = delivery(agencyHistory(), platformMessage(platformId, 'MNPQ-2345'))
    coexistence.mode = 'throw'
    await expect(post(body)).rejects.toThrow('forced agency failure')
    expect(await platformRows(platformId)).toHaveLength(0)

    coexistence.mode = 'real'
    expect((await post(body)).status).toBe(200)
    expect(await platformRows(platformId)).toHaveLength(1)
    expect((await ownerRow()).status).toBe('active')
  })

  it('a platform failure on top of an agency failure still answers with the agency failure, so Meta redelivers both', async () => {
    coexistence.mode = 'fail'
    platformFail.next = 1
    const res = await post(delivery(agencyHistory(), platformMessage(`wamid.__mixed_pl_${++seq}`, 'הסר')))
    expect(res.status).toBe(503)
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('event NOT saved'))).toBe(false)
  })
})

describe('routing', () => {
  it('a platform change in a later entry is processed, and the agency change in the first entry is handled as before', async () => {
    const inId = `wamid.__mixed_in_${++seq}`
    const plId = `wamid.__mixed_pl_${seq}`
    expect((await post(delivery(agencyInbound(inId), platformMessage(plId, 'הסר')))).status).toBe(200)
    expect(await db('inbox_messages').where({ agencyId: agencyA, externalId: inId })).toHaveLength(1)
    expect(await platformRows(plId)).toHaveLength(1)
  })

  it('a platform change first no longer hides the agency change behind it', async () => {
    const inId = `wamid.__mixed_in_${++seq}`
    expect((await post(delivery(platformMessage(`wamid.__mixed_pl_${seq}`, 'תודה'), agencyInbound(inId)))).status).toBe(200)
    expect(await db('inbox_messages').where({ agencyId: agencyA, externalId: inId })).toHaveLength(1)
  })

  it('platform-only traffic never reaches the agency path and makes no network call', async () => {
    const before = await agencySideEffects()
    const plId = `wamid.__mixed_pl_${++seq}`
    const body = delivery(platformMessage(plId, 'MNPQ-2345', 1_760_009_100), platformStatus(plId), platformEcho(`wamid.__mixed_pe_${seq}`))
    expect((await post(body)).status).toBe(200)
    expect(agencyHandlers).toEqual({ inbound: 0, statuses: 0, templates: 0 })
    expect(coexistence.calls).toEqual([])
    expect((await ownerRow()).status).toBe('active')
    expect(await agencySideEffects()).toEqual(before)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('with the platform number unset, its traffic takes the agency path exactly as today (no connection: ignored)', async () => {
    delete process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID
    try {
      const plId = `wamid.__mixed_pl_${++seq}`
      expect((await post(delivery(platformMessage(plId, 'הסר')))).status).toBe(200)
      expect(await platformRows(plId)).toHaveLength(0)
      expect((await ownerRow()).status).toBe('pending')
    } finally {
      process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
    }
  })
})
