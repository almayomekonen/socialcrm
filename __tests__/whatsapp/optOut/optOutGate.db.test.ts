import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { lockOptOutKeyExclusive, recordInboundOptOutCommand, readOptOutStatus } from '@/db/whatsappOptOuts'
import { recordInboundOptOut } from '@/lib/whatsapp/optOut/recordInbound'
import { sendWhatsappInteractive, sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { sendWhatsappTemplate } from '@/lib/whatsapp/sendTemplateMessage'

/**
 * Phase 0 Item 3: the opt-out store, its ordering rules, and the send gate —
 * including the race between saving an opt-out and starting a Meta request.
 * Synthetic agency ids and numbers; Meta is a stubbed `fetch`.
 */

const base = 960_000 + Math.floor(Math.random() * 30_000)
let seq = 0
const agency = () => base + ++seq
const used: number[] = []
const A = (n?: number) => {
  const id = n ?? agency()
  used.push(id)
  return id
}
const PHONE = '+972501112233'
const WA = '972501112233'
let msg = 0
const mid = () => `wamid.optout.${base}.${++msg}`
const at = (s: number) => new Date(Date.UTC(2026, 10, 6, 12, 0, s))

let fetchMock: ReturnType<typeof vi.fn>
function okFetch() {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: `wamid.out.${Math.random().toString(36).slice(2)}` }] }),
    headers: { get: () => null },
  }))
  vi.stubGlobal('fetch', fetchMock)
}
beforeEach(() => okFetch())
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await db('whatsapp_opt_out_events').whereIn('agencyId', used).del()
  await db('whatsapp_opt_outs').whereIn('agencyId', used).del()
})

const text = (agencyId: number, to = WA) =>
  sendWhatsappText({ phoneNumberId: 'pn', accessToken: 't', to, body: 'שלום', consent: { kind: 'automated', agencyId } })
const optOut = (agencyId: number, eventAt = at(0), id = mid()) =>
  recordInboundOptOutCommand({ agencyId, customerPhoneE164: PHONE, command: 'opt_out', eventAt, messageExternalId: id })
const optIn = (agencyId: number, eventAt = at(10), id = mid()) =>
  recordInboundOptOutCommand({ agencyId, customerPhoneE164: PHONE, command: 'opt_in', eventAt, messageExternalId: id })
const events = (agencyId: number) =>
  db('whatsapp_opt_out_events').where({ agencyId }).orderBy('id').select('kind', 'source', 'outcome', 'eventAt', 'messageExternalId')

describe('recording: ordering, history, duplicates', () => {
  it('an opt-out creates the state and an event; nothing else is stored', async () => {
    const a = A()
    expect((await optOut(a)).outcome).toBe('applied')
    expect(await readOptOutStatus(db, a, PHONE)).toBe('opted_out')
    const [row] = await db('whatsapp_opt_outs').where({ agencyId: a })
    expect(row).toMatchObject({ status: 'opted_out', customerPhoneE164: PHONE })
    expect(new Date(row.firstOptedOutAt).getTime()).toBe(at(0).getTime())
    expect(await events(a)).toMatchObject([{ kind: 'opt_out', source: 'inbound_command', outcome: 'applied' }])
  })

  it('a redelivered command (same wamid) is recorded once', async () => {
    const a = A()
    const id = mid()
    await optOut(a, at(0), id)
    expect((await optOut(a, at(0), id)).outcome).toBe('duplicate')
    expect(await events(a)).toHaveLength(1)
  })

  it('a second opt-out is history, not a state change', async () => {
    const a = A()
    await optOut(a, at(0))
    expect((await optOut(a, at(5))).outcome).toBe('already_in_state')
    expect(await events(a)).toHaveLength(2)
  })

  it('re-opt-in is valid only with an active opt-out', async () => {
    const a = A()
    expect((await optIn(a)).outcome).toBe('no_active_opt_out')
    expect(await readOptOutStatus(db, a, PHONE)).toBeNull()
    expect(await events(a)).toMatchObject([{ kind: 'opt_in', outcome: 'no_active_opt_out' }])
  })

  it('re-opt-in keeps the original opt-out: history and firstOptedOutAt survive', async () => {
    const a = A()
    await optOut(a, at(0))
    expect((await optIn(a, at(10))).outcome).toBe('applied')
    const [row] = await db('whatsapp_opt_outs').where({ agencyId: a })
    expect(row.status).toBe('opted_in')
    expect(new Date(row.firstOptedOutAt).getTime()).toBe(at(0).getTime())
    expect(new Date(row.optedInAt).getTime()).toBe(at(10).getTime())
    expect((await events(a)).map((e) => `${e.kind}:${e.outcome}`)).toEqual(['opt_out:applied', 'opt_in:applied'])
    // And opting out again is a fresh opt-out, first date unchanged.
    await optOut(a, at(20))
    const [again] = await db('whatsapp_opt_outs').where({ agencyId: a })
    expect(again.status).toBe('opted_out')
    expect(new Date(again.firstOptedOutAt).getTime()).toBe(at(0).getTime())
  })

  it('a tie between opt-out and re-opt-in goes to the opt-out', async () => {
    const a = A()
    await optOut(a, at(0))
    expect((await optIn(a, at(0))).outcome).toBe('stale')
    expect(await readOptOutStatus(db, a, PHONE)).toBe('opted_out')
  })

  it('an older command arriving late cannot undo a newer one', async () => {
    const a = A()
    await optOut(a, at(0))
    await optIn(a, at(30))
    expect((await optOut(a, at(10))).outcome).toBe('stale')
    expect(await readOptOutStatus(db, a, PHONE)).toBe('opted_in')
    // ...and a stale re-opt-in cannot lift a newer opt-out.
    const b = A()
    await optOut(b, at(30))
    expect((await optIn(b, at(10))).outcome).toBe('stale')
    expect(await readOptOutStatus(db, b, PHONE)).toBe('opted_out')
  })

  it('only a TYPED text message is a command; a tapped button or list title is not', async () => {
    const a = A()
    const base = { agencyId: a, customerWaId: WA, text: 'עצור', channelTimestamp: at(0) }
    expect(await recordInboundOptOut({ ...base, type: 'interactive', externalId: mid() })).toBeNull()
    expect(await recordInboundOptOut({ ...base, type: 'button', externalId: mid() })).toBeNull()
    expect(await readOptOutStatus(db, a, PHONE)).toBeNull()
    expect(await recordInboundOptOut({ ...base, type: 'text', externalId: mid() })).toBe('applied')
    expect(await readOptOutStatus(db, a, PHONE)).toBe('opted_out')
  })

  it('an ordinary message records nothing', async () => {
    const a = A()
    expect(await recordInboundOptOut({ agencyId: a, customerWaId: WA, type: 'text', text: 'אל תעצור', externalId: mid(), channelTimestamp: at(0) })).toBeNull()
    expect(await events(a)).toHaveLength(0)
  })

  it('the table rejects a number that is not E.164', async () => {
    await expect(
      db('whatsapp_opt_outs').insert({ agencyId: A(), customerPhoneE164: '0501112233', status: 'opted_out', firstOptedOutAt: at(0), optedOutAt: at(0), lastEventAt: at(0) }),
    ).rejects.toThrow()
  })
})

describe('the gate on automated sends', () => {
  it('an opted-out customer: blocked, final, and Meta is never called (text, interactive, template)', async () => {
    const a = A()
    await optOut(a)
    const t = await text(a)
    const i = await sendWhatsappInteractive({ phoneNumberId: 'pn', accessToken: 't', to: WA, body: 'x', interactive: { type: 'button' }, consent: { kind: 'automated', agencyId: a } })
    const tpl = await sendWhatsappTemplate({ phoneNumberId: 'pn', accessToken: 't', to: WA, name: 'n', language: 'he', params: [], consent: { kind: 'automated', agencyId: a } })
    for (const r of [t, i, tpl]) expect(r).toMatchObject({ ok: false, optOutBlocked: true, optOutBlockReason: 'opted_out' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the Israeli local form of the same number is blocked too', async () => {
    const a = A()
    await optOut(a)
    expect(await text(a, '0501112233')).toMatchObject({ optOutBlocked: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('not opted out, or re-opted in: the send goes through', async () => {
    const a = A()
    expect(await text(a)).toMatchObject({ ok: true })
    await optOut(a, at(0))
    await optIn(a, at(10))
    expect(await text(a)).toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tenant isolation: one business’s opt-out does not touch another business', async () => {
    const a = A()
    const b = A()
    await optOut(a)
    expect(await text(a)).toMatchObject({ optOutBlocked: true })
    expect(await text(b)).toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('every retry is checked again: a send that passed, then an opt-out, then the retry is blocked', async () => {
    const a = A()
    expect(await text(a)).toMatchObject({ ok: true })
    await optOut(a)
    expect(await text(a)).toMatchObject({ optOutBlocked: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed: no consent, or a recipient that is not a number, is never sent', async () => {
    const noConsent = await sendWhatsappText({ phoneNumberId: 'pn', accessToken: 't', to: WA, body: 'x' } as never)
    expect(noConsent).toMatchObject({ optOutBlocked: true, optOutBlockReason: 'missing_consent' })
    expect(await text(A(), 'abc')).toMatchObject({ optOutBlocked: true, optOutBlockReason: 'invalid_recipient' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('manual sends', () => {
  const tpl = (agencyId: number, category: string | null, exceptionReason?: string) =>
    sendWhatsappTemplate({
      phoneNumberId: 'pn',
      accessToken: 't',
      to: WA,
      name: 'tpl',
      language: 'he',
      params: [],
      consent: { kind: 'manual_template', agencyId, userId: 77, templateId: 5, templateName: 'tpl', templateCategory: category, exceptionReason },
    })

  it('a rep’s own free-text reply is not blocked', async () => {
    const a = A()
    await optOut(a)
    expect(
      await sendWhatsappText({ phoneNumberId: 'pn', accessToken: 't', to: WA, body: 'x', consent: { kind: 'manual_reply', agencyId: a, userId: 77 } }),
    ).toMatchObject({ ok: true })
  })

  it('MARKETING to an opted-out customer is always blocked, reason or not', async () => {
    const a = A()
    await optOut(a)
    expect(await tpl(a, 'MARKETING', 'הלקוח ביקש עדכון על ההזמנה שלו')).toMatchObject({ optOutBlockReason: 'opted_out_marketing' })
    expect(await tpl(a, null, 'הלקוח ביקש עדכון על ההזמנה שלו')).toMatchObject({ optOutBlockReason: 'opted_out_marketing' })
    expect(await tpl(a, 'AUTHENTICATION', 'הלקוח ביקש עדכון על ההזמנה שלו')).toMatchObject({ optOutBlockReason: 'opted_out_marketing' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await events(a)).toHaveLength(1) // only the opt-out itself
  })

  it('UTILITY to an opted-out customer needs a reason; with one it is sent and audited', async () => {
    const a = A()
    await optOut(a)
    expect(await tpl(a, 'UTILITY')).toMatchObject({ optOutBlockReason: 'opted_out_exception_required' })
    expect(await tpl(a, 'UTILITY', 'קצר')).toMatchObject({ optOutBlockReason: 'opted_out_exception_required' })
    expect(fetchMock).not.toHaveBeenCalled()

    const sent = await tpl(a, 'UTILITY', 'עדכון על תיקון שהליד הזמין אתמול')
    expect(sent).toMatchObject({ ok: true })
    const [ex] = await db('whatsapp_opt_out_events').where({ agencyId: a, kind: 'manual_exception' })
    expect(ex).toMatchObject({
      source: 'manual_template',
      outcome: 'granted',
      actorUserId: 77,
      templateId: 5,
      templateName: 'tpl',
      templateCategory: 'UTILITY',
      reason: 'עדכון על תיקון שהליד הזמין אתמול',
      providerMessageId: (sent as { wamid: string }).wamid,
    })
    expect(await readOptOutStatus(db, a, PHONE)).toBe('opted_out') // an exception never lifts the opt-out
  })

  it('a customer who is not opted out gets manual templates with no exception recorded', async () => {
    const a = A()
    expect(await tpl(a, 'MARKETING')).toMatchObject({ ok: true })
    expect(await events(a)).toHaveLength(0)
  })
})

describe('the race between saving an opt-out and starting a Meta request', () => {
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))
  async function until(cond: () => boolean, ms = 3000) {
    const end = Date.now() + ms
    while (!cond()) {
      if (Date.now() > end) throw new Error('timed out')
      await tick(10)
    }
  }

  it('a request already in flight finishes; the opt-out waits for it; the next send is blocked', async () => {
    const a = A()
    let release!: () => void
    fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.inflight' }] }), headers: { get: () => null } })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const sending = text(a)
    await until(() => fetchMock.mock.calls.length === 1)

    let recorded = false
    const recording = optOut(a).then((r) => {
      recorded = true
      return r
    })
    await tick(300)
    expect(recorded).toBe(false) // the opt-out cannot commit while the request is in flight

    release()
    expect(await sending).toMatchObject({ ok: true, wamid: 'wamid.inflight' })
    expect((await recording).outcome).toBe('applied')

    okFetch()
    expect(await text(a)).toMatchObject({ optOutBlocked: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an opt-out that took the lock first: the send waits, then is blocked without any request', async () => {
    const a = A()
    const trx = await db.transaction()
    await lockOptOutKeyExclusive(trx, a, PHONE)
    await trx('whatsapp_opt_outs').insert({ agencyId: a, customerPhoneE164: PHONE, status: 'opted_out', firstOptedOutAt: at(0), optedOutAt: at(0), lastEventAt: at(0) })

    let done = false
    const sending = text(a).then((r) => {
      done = true
      return r
    })
    await tick(300)
    expect(done).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    await trx.commit()
    expect(await sending).toMatchObject({ optOutBlocked: true, optOutBlockReason: 'opted_out' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an opt-out that rolled back does not block: the waiting send then goes through', async () => {
    const a = A()
    const trx = await db.transaction()
    await lockOptOutKeyExclusive(trx, a, PHONE)
    await trx('whatsapp_opt_outs').insert({ agencyId: a, customerPhoneE164: PHONE, status: 'opted_out', firstOptedOutAt: at(0), optedOutAt: at(0), lastEventAt: at(0) })
    const sending = text(a)
    await tick(200)
    expect(fetchMock).not.toHaveBeenCalled()
    await trx.rollback()
    expect(await sending).toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('many concurrent sends and one opt-out: every send after the opt-out commits is blocked', async () => {
    const a = A()
    let calls = 0
    fetchMock = vi.fn(async () => {
      calls++
      await tick(20)
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.c${calls}` }] }), headers: { get: () => null } }
    })
    vi.stubGlobal('fetch', fetchMock)
    const results: Array<{ startedAt: number; r: unknown }> = []
    let committedAt = Infinity
    const sends = Array.from({ length: 12 }, async (_, i) => {
      await tick(i * 15)
      const startedAt = Date.now()
      results.push({ startedAt, r: await text(a) })
    })
    const recording = (async () => {
      await tick(60)
      await optOut(a)
      committedAt = Date.now()
    })()
    await Promise.all([...sends, recording])
    // A send that started after the opt-out committed was never sent.
    for (const { startedAt, r } of results) {
      if (startedAt > committedAt) expect(r).toMatchObject({ optOutBlocked: true })
    }
    // Every request Meta saw was issued before the opt-out committed.
    expect(calls).toBe(results.filter(({ r }) => (r as { ok: boolean }).ok).length)
    expect(results.some(({ r }) => (r as { optOutBlocked?: boolean }).optOutBlocked)).toBe(true)
  })
})
