import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The event-links message on the real schema, through the real webhook route, lock,
 * eligibility check and opt-out gate. Only the network is replaced: `fetch` is stubbed,
 * so nothing can reach Meta.
 */

type Cta = { type: string; body: { text: string }; action: { name: string; parameters: { display_text: string; url: string } } }
type Template = { name: string; language: { code: string }; components?: unknown[] }
type Payload = {
  type: string
  to?: string
  text?: { body: string; preview_url: boolean }
  interactive?: Cta
  template?: Template
}
type Reply = { status: number; body: unknown } | Error | void

const h = vi.hoisted(() => ({
  beforePersist: null as null | ((input: { text: string }) => Promise<void> | void),
}))

vi.mock('@/lib/inbox/persistOutboundWhatsapp', async (orig) => {
  const real = await orig<typeof import('@/lib/inbox/persistOutboundWhatsapp')>()
  return {
    ...real,
    persistOutboundWhatsapp: async (input: Parameters<typeof real.persistOutboundWhatsapp>[0]) => {
      await h.beforePersist?.(input)
      return real.persistOutboundWhatsapp(input)
    },
  }
})

const { db } = await import('@/config/db')
const { sendInvitationViaIntegration, invitationStatuses } = await import('@/lib/weddingRsvp/integration')
const { sendRsvpRequestViaIntegration } = await import('@/lib/weddingRsvp/integrationRsvp')
const { routeWeddingRsvpReply } = await import('@/lib/weddingRsvp/handleReply')
const { REPLY_ATTENDING, REPLY_NOT_ATTENDING, REPLY_THANKS, WEDDING_RSVP_SOURCE } = await import('@/lib/weddingRsvp/config')
const {
  EVENT_LINKS_CLAIM_KEY,
  EVENT_LINKS_STEP,
  eventLinkMessages,
  eventLinkStoredText,
  readEventLinks,
  GIFT_TEMPLATE,
  sendEventLinksAfterThanks,
} = await import('@/lib/weddingRsvp/eventLinks')
const { handleInboundWebhookMessage } = await import('@/lib/whatsapp/handleInboundWebhookMessage')
const { ingestWhatsappStatuses } = await import('@/lib/inbox/ingestWhatsappStatuses')

const AGENCY = 103
const PN = '__wedding_links_pn'
const GUEST = '972545550021'
/** A second, unrelated guest: proves the links are not tied to any one number. */
const SECOND_GUEST = '972545550022'
/**
 * The test baseline keeps a global unique index on clients.leadSource (production
 * does not), so the second guest is an existing Lead — the invite reuses it by phone.
 */
const SECOND_GUEST_SOURCE = '__wedding_links_second_guest'
const WAZE = 'https://waze.com/ul?q=SERA%20%D7%A1%D7%A8%D7%94%20%D7%A2%D7%9E%D7%A7%20%D7%94%D7%90%D7%9C%D7%94&navigate=yes'
/** The gift URLs are static parts of the approved template; they must never appear in our payloads, rows or logs. */
const BIT = 'https://www.bitpay.co.il/app/share-info'
const PAYBOX = 'https://links.payboxapp.com/EvZawEB4W7b'
const [WAZE_MESSAGE, GIFT_MESSAGE] = eventLinkMessages({ waze: WAZE })
const WAZE_STORED = eventLinkStoredText(WAZE_MESSAGE)
const GIFT_STORED = eventLinkStoredText(GIFT_MESSAGE)
const GIFT = `TEMPLATE:${GIFT_TEMPLATE.name}`
/** The whole event-links sequence: exactly two messages. */
const LINKS = [`CTA:${WAZE}`, GIFT]

let userId: number
let agencyCreated = false
let wamid = 0
let conversationId: number
let leadId: number
let graph: Payload[]
let respond: (p: Payload) => Promise<Reply> | Reply

const ctaUrl = (p: Payload) => p.interactive?.action.parameters.url
/** Everything sent after the RSVP template, in order: text bodies, and each CTA by its URL. */
const isGift = (p: Payload) => p.type === 'template' && p.template?.name === GIFT_TEMPLATE.name
/** Everything sent after the invite + RSVP templates, in order: texts, each CTA by its URL, the gift template by name. */
const texts = () =>
  graph
    .filter((p) => p.type !== 'template' || isGift(p))
    .map((p) => (p.type === 'text' ? p.text!.body : isGift(p) ? GIFT : `CTA:${ctaUrl(p)}`))
const isWaze = (p: Payload) => ctaUrl(p) === WAZE
const isThanks = (p: Payload) => p.text?.body === REPLY_THANKS
const linksRows = () =>
  db('inbox_messages')
    .where({ conversationId, direction: 'outbound' })
    .whereRaw(`metadata->>'step' = ?`, [EVENT_LINKS_STEP])
    .select('id', 'text', 'metadata', 'status', 'sentByUserId')
const thanksRows = () =>
  db('inbox_messages')
    .where({ conversationId, direction: 'outbound' })
    .whereRaw(`metadata->>'step' = 'thanks'`)
    .orderBy('id')
    .select('id', 'externalId', 'metadata')
const claimedRows = async () => (await thanksRows()).filter((r) => r.metadata[EVENT_LINKS_CLAIM_KEY])
const linksAttempts = () => graph.filter(isWaze).length

async function cleanup() {
  const ids = (await db('inbox_conversations')
    .where({ agencyId: AGENCY })
    .whereIn('customerWaId', [GUEST, SECOND_GUEST])
    .pluck('id')) as number[]
  await db('inbox_messages').whereIn('conversationId', ids).del()
  await db('conversation_ai_state').whereIn('conversationId', ids).del()
  await db('inbox_participants').whereIn('conversationId', ids).del()
  await db('inbox_conversations').whereIn('id', ids).del()
  await db('clients').where({ agencyId: AGENCY }).whereIn('leadSource', ['wedding_invite', SECOND_GUEST_SOURCE]).del()
  await db('whatsapp_opt_outs')
    .where({ agencyId: AGENCY })
    .whereIn('customerPhoneE164', [`+${GUEST}`, `+${SECOND_GUEST}`])
    .del()
}

async function inbound(row: Record<string, unknown>): Promise<number> {
  const max = await db('inbox_messages').where({ conversationId }).max('sequence as max').first()
  const [m] = await db('inbox_messages')
    .insert({
      conversationId,
      agencyId: AGENCY,
      leadId,
      channel: 'whatsapp',
      direction: 'inbound',
      fromId: GUEST,
      toId: PN,
      status: 'received',
      sequence: (Number(max?.max) || 0) + 1,
      externalId: `wamid.IN${Math.random()}`,
      rawPayload: JSON.stringify({}),
      payload: JSON.stringify({}),
      ...row,
    })
    .returning('id')
  return Number(m.id)
}

const route = (messageId: number, rawMessage: unknown) =>
  routeWeddingRsvpReply({ agencyId: AGENCY, conversationId, leadId, messageId, rawMessage })
const tap = async (payload: 'wedding_rsvp_attending' | 'wedding_rsvp_not_attending') =>
  route(await inbound({ type: 'button', text: 'tap', payload: JSON.stringify({ payload, text: 'tap' }) }), {
    id: 'wamid.tap',
    from: GUEST,
    type: 'button',
    button: { payload, text: 'tap' },
  })
const answer = async (n: string) =>
  route(await inbound({ type: 'text', text: n }), { id: 'wamid.count', from: GUEST, type: 'text', text: { body: n } })

const THANKED = { handled: true, headCount: 4, replied: true }
const reconfirm = async () => {
  await tap('wedding_rsvp_attending')
  return answer('5')
}

beforeAll(async () => {
  if (!(await db('agencies').where({ id: AGENCY }).first('id'))) {
    await db('agencies').insert({ id: AGENCY, name: '__test_wedding_agency__' })
    agencyCreated = true
  }
  const [u] = await db('users').insert({ firstName: 'Almayo', role: 'AGNT', agencyId: AGENCY }).returning('id')
  userId = Number(u.id)
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: AGENCY, phone_number_id: PN, access_token: 'test-token' })
  process.env.WEDDING_INTEGRATION_USER_ID = String(userId)
})

beforeEach(async () => {
  await cleanup()
  graph = []
  respond = () => undefined
  h.beforePersist = null
  process.env.WEDDING_WAZE_URL = WAZE
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as Payload
      graph.push(payload)
      const reply = await respond(payload)
      if (reply instanceof Error) throw reply
      if (reply) return new Response(JSON.stringify(reply.body), { status: reply.status })
      return new Response(JSON.stringify({ messages: [{ id: `wamid.LINKS${++wamid}` }] }), { status: 200 })
    }),
  )
  const inv = 'dddddddd-0001-4333-8333-333333333333'
  expect(
    (await sendInvitationViaIntegration({ invitationId: inv, phone: GUEST, firstName: 'אורח', lastName: 'בדיקה' })).httpStatus,
  ).toBe(200)
  expect(
    (
      await sendRsvpRequestViaIntegration({
        requestId: 'eeeeeeee-0001-4333-8333-333333333333',
        phone: GUEST,
        firstName: 'אורח',
        lastName: 'בדיקה',
      })
    ).httpStatus,
  ).toBe(200)
  const conv = await db('inbox_conversations').where({ agencyId: AGENCY, customerWaId: GUEST }).first('id', 'leadId')
  conversationId = Number(conv.id)
  leadId = Number(conv.leadId)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.WEDDING_WAZE_URL
  delete process.env.WEDDING_EVENT_LINKS_TEST_PHONE // only set by the stale-config test
})

afterAll(async () => {
  await cleanup()
  await db('whatsapp_connections').where({ phone_number_id: PN }).del()
  await db('users').where({ id: userId }).del()
  if (agencyCreated) await db('agencies').where({ id: AGENCY }).del()
})

describe('the links follow a successful thank-you', () => {
  it('sends exactly two messages after the thank-you — Waze, then the gift template — without changing the RSVP result', async () => {
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)

    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, ...LINKS])
    expect(await linksRows()).toHaveLength(2)
  })

  it('leaves the head count reported to the Wedding Manager intact', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const { rsvp } = await invitationStatuses({ invitations: [], phones: [GUEST] })
    expect(rsvp).toEqual([expect.objectContaining({ phone: GUEST, rsvp: 'attending', headcount: 4 })])
  })
})

describe('when the links must not be sent', () => {
  it('not before the head count is received', async () => {
    await tap('wedding_rsvp_attending')
    expect(texts()).toEqual([REPLY_ATTENDING])
    expect(await linksRows()).toHaveLength(0)
  })

  it('not for a declined RSVP', async () => {
    await tap('wedding_rsvp_not_attending')
    expect(await answer('4')).toEqual({ handled: false })
    expect(texts()).toEqual([REPLY_NOT_ATTENDING])
    expect(await linksRows()).toHaveLength(0)
  })

  it('not if the thank-you fails', async () => {
    await tap('wedding_rsvp_attending')
    respond = (p) => (isThanks(p) ? { status: 400, body: { error: { message: 'window', code: 131047 } } } : undefined)
    expect(await answer('4')).toEqual({ handled: true, headCount: 4, replied: false, reason: 'send-failed' })
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS])
    expect(await linksRows()).toHaveLength(0)
  })

  it('not to a guest who opted out after the thank-you left: the real gate refuses', async () => {
    await tap('wedding_rsvp_attending')
    respond = async (p) => {
      if (!isThanks(p)) return
      const now = new Date()
      await db('whatsapp_opt_outs').insert({
        agencyId: AGENCY,
        customerPhoneE164: `+${GUEST}`,
        status: 'opted_out',
        firstOptedOutAt: now,
        optedOutAt: now,
        lastEventAt: now,
      })
    }
    expect(await answer('4')).toEqual(THANKED)
    expect(graph.some(isWaze)).toBe(false)
    expect(await linksRows()).toHaveLength(0)
  })
})

describe('no duplicates', () => {
  it('a repeated head count is ignored', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    expect(await answer('4')).toEqual({ handled: false })
    expect(texts().filter((t) => LINKS.includes(t))).toEqual(LINKS)
  })

  it('re-tapping and answering again earns a second thank-you but not second links', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    await tap('wedding_rsvp_attending')
    expect(await answer('5')).toEqual({ handled: true, headCount: 5, replied: true })
    expect(await thanksRows()).toHaveLength(2)
    expect(texts().filter((t) => LINKS.includes(t))).toEqual(LINKS)
  })

  it('two simultaneous head counts send once', async () => {
    await tap('wedding_rsvp_attending')
    const first = await inbound({ type: 'text', text: '4' })
    const second = await inbound({ type: 'text', text: '4' })
    const raw = { id: 'wamid.count', from: GUEST, type: 'text', text: { body: '4' } }
    await Promise.all([route(first, raw), route(second, raw)])
    expect(await thanksRows()).toHaveLength(1)
    expect(texts().filter((t) => LINKS.includes(t))).toEqual(LINKS)
  })

  it('links Meta later reported as failed are not re-sent on a new confirmation: the claim is never released', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    await db('inbox_messages')
      .where({ conversationId })
      .whereRaw(`metadata->>'step' = ?`, [EVENT_LINKS_STEP])
      .update({ status: 'failed' })
    await reconfirm()
    expect(linksAttempts()).toBe(1)
  })
})

describe('the pre-send claim: at most one attempt per conversation', () => {
  const quiet = () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  }

  it('re-confirming after a fetch rejection does not send twice', async () => {
    quiet()
    await tap('wedding_rsvp_attending')
    respond = (p) => (isWaze(p) ? new Error('timeout') : undefined)
    await answer('4')
    expect(await reconfirm()).toEqual({ handled: true, headCount: 5, replied: true })
    expect(linksAttempts()).toBe(1)
    expect(await linksRows()).toHaveLength(0)
    expect(await thanksRows()).toHaveLength(2)
  })

  it('re-confirming after a 2xx with no message id does not send twice', async () => {
    quiet()
    await tap('wedding_rsvp_attending')
    respond = (p) => (isWaze(p) ? { status: 200, body: {} } : undefined)
    await answer('4')
    await reconfirm()
    expect(linksAttempts()).toBe(1)
    expect(await linksRows()).toHaveLength(0)
  })

  it('re-confirming after Meta accepted but the save failed does not send twice', async () => {
    quiet()
    await tap('wedding_rsvp_attending')
    h.beforePersist = (input) => {
      if (input.text === WAZE_STORED) throw new Error('save failed')
    }
    await answer('4')
    expect(await linksRows()).toHaveLength(0)
    await reconfirm()
    expect(linksAttempts()).toBe(1)
  })

  it('the claim is already committed when the Graph call is made', async () => {
    await tap('wedding_rsvp_attending')
    let claimedAtSend: number | null = null
    respond = async (p) => {
      if (isWaze(p)) claimedAtSend = (await claimedRows()).length
    }
    await answer('4')
    expect(claimedAtSend).toBe(1)
  })

  it('a failed claim write sends nothing and leaves the RSVP outcome alone', async () => {
    await tap('wedding_rsvp_attending')
    const realRaw = db.raw.bind(db)
    vi.spyOn(db, 'raw').mockImplementation(((sql: string, ...rest: unknown[]) => {
      if (String(sql).includes(EVENT_LINKS_CLAIM_KEY)) throw new Error('claim write failed')
      return (realRaw as (...a: unknown[]) => unknown)(sql, ...rest)
    }) as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await answer('4')).toEqual(THANKED)
    expect(linksAttempts()).toBe(0)
    expect(await thanksRows()).toHaveLength(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('event links failed'), expect.objectContaining({ error: 'Error' }))
  })

  it('invalid configuration does not claim, so a later valid configuration can still send', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.WEDDING_WAZE_URL = 'http://waze.test.invalid/x'
    await tap('wedding_rsvp_attending')
    await answer('4')
    expect(await claimedRows()).toHaveLength(0)
    expect(graph.filter(isGift)).toHaveLength(0)

    process.env.WEDDING_WAZE_URL = WAZE
    await reconfirm()
    expect(linksAttempts()).toBe(1)
    expect(await claimedRows()).toHaveLength(1)
  })

  it('a delivery-status webhook on the thank-you keeps the claim', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const [thanks] = await thanksRows()
    const before = thanks.metadata[EVENT_LINKS_CLAIM_KEY]
    expect(before).toBeTruthy()

    const result = await ingestWhatsappStatuses(PN, [
      { id: thanks.externalId, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: GUEST },
    ])
    expect(result).toMatchObject({ errored: 0 })

    const [after] = await thanksRows()
    expect(after.metadata[EVENT_LINKS_CLAIM_KEY]).toBe(before)
    expect(after.metadata.delivery).toBeTruthy()
    await reconfirm()
    expect(linksAttempts()).toBe(1)
  })

  it('the same inbound head-count webhook delivered twice runs the flow once', async () => {
    await tap('wedding_rsvp_attending')
    const connection = await db('whatsapp_connections').where({ phone_number_id: PN }).first()
    const message = {
      id: 'wamid.LINKSDUPLICATE1',
      from: GUEST,
      type: 'text',
      timestamp: String(Math.floor(Date.now() / 1000)),
      text: { body: '4' },
    }
    const deliver = () =>
      handleInboundWebhookMessage({ message, phoneNumberId: PN, profileName: 'אורח', connection: connection as never })

    expect(await deliver()).toMatchObject({ persisted: true })
    expect(await deliver()).toMatchObject({ persisted: true })

    expect(await db('inbox_messages').where({ externalId: message.id })).toHaveLength(1)
    expect(await thanksRows()).toHaveLength(1)
    expect(texts().filter((t) => LINKS.includes(t))).toEqual(LINKS)
  })

  it('two claims racing without the conversation lock still send once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    delete process.env.WEDDING_WAZE_URL
    await tap('wedding_rsvp_attending')
    await answer('4')
    process.env.WEDDING_WAZE_URL = WAZE
    const args = { agencyId: AGENCY, conversationId, leadId }
    await Promise.all([sendEventLinksAfterThanks(args), sendEventLinksAfterThanks(args), sendEventLinksAfterThanks(args)])
    expect(texts().filter((t) => LINKS.includes(t))).toEqual(LINKS)
  })
})

describe('every guest who completes the RSVP receives the links', () => {
  const allLogs = () => [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  ]
  const printed = (spies: ReturnType<typeof allLogs>) => JSON.stringify(spies.map((s) => s.mock.calls))

  /** Invite + template RSVP request for SECOND_GUEST, then route in THEIR conversation. */
  async function secondGuest() {
    await db('clients').insert({
      agencyId: AGENCY,
      firstName: 'אורחת',
      lastName: 'שנייה',
      phone: SECOND_GUEST,
      lead: true,
      status: 'new',
      leadSource: SECOND_GUEST_SOURCE,
      createdById: userId,
      userId,
      handlerId: userId,
    })
    expect(
      (
        await sendInvitationViaIntegration({
          invitationId: 'dddddddd-0002-4333-8333-333333333333',
          phone: SECOND_GUEST,
          firstName: 'אורחת',
          lastName: 'שנייה',
        })
      ).httpStatus,
    ).toBe(200)
    expect(
      (
        await sendRsvpRequestViaIntegration({
          requestId: 'eeeeeeee-0002-4333-8333-333333333333',
          phone: SECOND_GUEST,
          firstName: 'אורחת',
          lastName: 'שנייה',
        })
      ).httpStatus,
    ).toBe(200)
    const conv = await db('inbox_conversations').where({ agencyId: AGENCY, customerWaId: SECOND_GUEST }).first('id', 'leadId')
    const ids = { conversationId: Number(conv.id), leadId: Number(conv.leadId) }
    const send = async (row: Record<string, unknown>, raw: Record<string, unknown>) => {
      const max = await db('inbox_messages').where({ conversationId: ids.conversationId }).max('sequence as max').first()
      const [m] = await db('inbox_messages')
        .insert({
          conversationId: ids.conversationId,
          agencyId: AGENCY,
          leadId: ids.leadId,
          channel: 'whatsapp',
          direction: 'inbound',
          fromId: SECOND_GUEST,
          toId: PN,
          status: 'received',
          sequence: (Number(max?.max) || 0) + 1,
          externalId: `wamid.IN2${Math.random()}`,
          rawPayload: JSON.stringify({}),
          payload: JSON.stringify({}),
          ...row,
        })
        .returning('id')
      return routeWeddingRsvpReply({
        agencyId: AGENCY,
        ...ids,
        messageId: Number(m.id),
        rawMessage: { from: SECOND_GUEST, ...raw },
      })
    }
    return {
      ...ids,
      tap: () =>
        send(
          { type: 'button', text: 'tap', payload: JSON.stringify({ payload: 'wedding_rsvp_attending', text: 'tap' }) },
          { id: 'wamid.tap2', type: 'button', button: { payload: 'wedding_rsvp_attending', text: 'tap' } },
        ),
      answer: (n: string) => send({ type: 'text', text: n }, { id: 'wamid.count2', type: 'text', text: { body: n } }),
    }
  }
  const linksTo = (phone: string) =>
    graph.filter((p) => p.to === phone && (isWaze(p) || isGift(p))).map((p) => (isGift(p) ? GIFT : `CTA:${ctaUrl(p)}`))

  it('needs no test-phone, Bit or PayBox variable: only the Waze URL is configuration', () => {
    delete process.env.WEDDING_EVENT_LINKS_TEST_PHONE
    delete process.env.WEDDING_BIT_URL
    delete process.env.WEDDING_PAYBOX_URL
    expect(readEventLinks()).toEqual({ links: { waze: WAZE }, invalid: [] })
    delete process.env.WEDDING_WAZE_URL
    expect(readEventLinks()).toEqual({ links: null, invalid: ['WEDDING_WAZE_URL'] })
  })

  it('a guest named in no configuration receives both links once', async () => {
    expect(process.env.WEDDING_EVENT_LINKS_TEST_PHONE).toBeUndefined()
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, ...LINKS])
    expect(await claimedRows()).toHaveLength(1)
  })

  it('two different guests each receive their own pair, once, even after re-confirming', async () => {
    const other = await secondGuest()
    await tap('wedding_rsvp_attending')
    await answer('4')
    await other.tap()
    expect(await other.answer('3')).toEqual({ handled: true, headCount: 3, replied: true })
    await reconfirm()
    await other.tap()
    await other.answer('2')

    expect(linksTo(GUEST)).toEqual(LINKS)
    expect(linksTo(SECOND_GUEST)).toEqual(LINKS)
    const claims = await db('inbox_messages')
      .whereIn('conversationId', [conversationId, other.conversationId])
      .whereRaw(`metadata->>'${EVENT_LINKS_CLAIM_KEY}' IS NOT NULL`)
      .pluck('conversationId')
    expect(claims.map(Number).sort()).toEqual([conversationId, other.conversationId].sort())
  })

  it('a stale WEDDING_EVENT_LINKS_TEST_PHONE naming someone else restricts nothing and is never printed', async () => {
    process.env.WEDDING_EVENT_LINKS_TEST_PHONE = '972545559999'
    const spies = allLogs()
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, ...LINKS])
    expect(printed(spies)).not.toContain('972545559999')
  })

  it('an unprompted number, with no head-count question asked, sends nothing', async () => {
    expect(await answer('4')).toEqual({ handled: false })
    expect(texts()).toEqual([])
    expect(await claimedRows()).toHaveLength(0)
  })

  it('the existing decline and head-count behavior is unchanged', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const { rsvp } = await invitationStatuses({ invitations: [], phones: [GUEST] })
    expect(rsvp).toEqual([expect.objectContaining({ phone: GUEST, rsvp: 'attending', headcount: 4 })])
    expect(await answer('4')).toEqual({ handled: false })
    await tap('wedding_rsvp_not_attending')
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, ...LINKS, REPLY_NOT_ATTENDING])
  })
})

describe('the two event-link messages', () => {
  const quietLogs = () => [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  ]
  const printed = (spies: ReturnType<typeof quietLogs>) => JSON.stringify(spies.map((s) => s.mock.calls))
  const failure = (kind: string): Reply =>
    kind === 'refused'
      ? { status: 400, body: { error: { message: 'refused', code: 131000 } } }
      : kind === 'no id'
        ? { status: 200, body: {} }
        : new Error('timeout')

  it('sends exactly two Cloud API payloads: the Waze cta_url, then the gift template by name', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const sentAfterThanks = graph.slice(graph.findIndex(isThanks) + 1)
    expect(sentAfterThanks).toEqual([
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: GUEST,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: 'ניווט לאירוע:\nSERA – סרה, עמק האלה' },
          action: { name: 'cta_url', parameters: { display_text: 'פתיחת Waze', url: WAZE } },
        },
      },
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: GUEST,
        type: 'template',
        // Static template: both URL buttons are fixed at Meta, so no components are sent.
        template: { name: 'wedding_gift_links', language: { code: 'he' } },
      },
    ])
  })

  it('sends no separate Bit or PayBox CTA: the only interactive is Waze, and no gift URL leaves in a payload', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    expect(graph.filter((p) => p.type === 'interactive').map(ctaUrl)).toEqual([WAZE])
    expect(graph.filter(isGift)).toHaveLength(1)
    const payloads = JSON.stringify(graph)
    expect(payloads).not.toContain('bitpay')
    expect(payloads).not.toContain('payboxapp')
  })

  it('defines one gift message with both options, within Meta limits', () => {
    expect(GIFT_TEMPLATE).toEqual({
      name: 'wedding_gift_links',
      language: 'he',
      body: 'למי שרוצה לשלוח מתנה לחתונה 💝',
      buttons: ['שליחת מתנה ב-Bit', 'הצטרפות ב-PayBox'],
    })
    // cta_url display_text ≤ 20; template URL button text ≤ 25; bodies ≤ 1024.
    expect([...WAZE_MESSAGE.body].length).toBeLessThanOrEqual(1024)
    expect(WAZE_MESSAGE.kind === 'cta' && [...WAZE_MESSAGE.label].length).toBeLessThanOrEqual(20)
    for (const b of GIFT_TEMPLATE.buttons) expect([...b].length).toBeLessThanOrEqual(25)
    expect(eventLinkMessages({ waze: WAZE }).map((m) => m.link)).toEqual(['waze', 'gift'])
  })

  it('persists both messages by the existing conventions, with one claim and no URL in the stored text', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const rows = await linksRows()
    expect(rows.map((r) => r.text).sort()).toEqual([WAZE_STORED, GIFT_STORED].sort())
    expect(GIFT_STORED).toBe('למי שרוצה לשלוח מתנה לחתונה 💝\n\n[שליחת מתנה ב-Bit] [הצטרפות ב-PayBox]')
    for (const row of rows) {
      expect(row).toMatchObject({ sentByUserId: null, status: 'sent' })
      expect(row.metadata).toMatchObject({ source: WEDDING_RSVP_SOURCE, step: EVENT_LINKS_STEP })
      expect(row.text).not.toContain('https://')
    }
    expect(rows.map((r) => r.metadata.link).sort()).toEqual(['gift', 'waze'])
    expect(await claimedRows()).toHaveLength(1)
  })

  it('leaves head-count reporting and later answers alone after the pair', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const { rsvp } = await invitationStatuses({ invitations: [], phones: [GUEST] })
    expect(rsvp).toEqual([expect.objectContaining({ headcount: 4, rsvp: 'attending' })])
    expect(await answer('4')).toEqual({ handled: false })
  })

  it.each(['refused', 'timed out', 'no id'])(
    'Waze %s: the gift template is not sent and a re-confirmation sends nothing',
    async (kind) => {
      const spies = quietLogs()
      await tap('wedding_rsvp_attending')
      respond = (p) => (isWaze(p) ? failure(kind) : undefined)
      expect(await answer('4')).toEqual(THANKED)
      expect(graph.filter(isGift)).toHaveLength(0)
      expect(await linksRows()).toHaveLength(0)
      expect(await thanksRows()).toHaveLength(1)
      await reconfirm()
      expect(linksAttempts()).toBe(1)
      expect(graph.filter(isGift)).toHaveLength(0)
      expect(printed(spies)).toContain('"link":"waze"')
      expect(printed(spies)).not.toContain('test.invalid')
    },
  )

  it.each(['refused', 'timed out', 'no id'])(
    'gift template %s: Waze stays recorded, nothing is retried, the failure names the gift',
    async (kind) => {
      const spies = quietLogs()
      await tap('wedding_rsvp_attending')
      respond = (p) => (isGift(p) ? failure(kind) : undefined)
      expect(await answer('4')).toEqual(THANKED)
      expect((await linksRows()).map((r) => r.text)).toEqual([WAZE_STORED])
      expect(await thanksRows()).toHaveLength(1)
      await reconfirm()
      expect(linksAttempts()).toBe(1)
      expect(graph.filter(isGift)).toHaveLength(1)
      expect(printed(spies)).toContain('"link":"gift"')
      expect(printed(spies)).not.toContain('test.invalid')
    },
  )

  it('a failed save of the gift message is contained and names the gift', async () => {
    const spies = quietLogs()
    await tap('wedding_rsvp_attending')
    h.beforePersist = (input) => {
      if (input.text === GIFT_STORED) throw new Error(`insert ... ('${GIFT_STORED}') - boom`)
    }
    expect(await answer('4')).toEqual(THANKED)
    expect((await linksRows()).map((r) => r.text)).toEqual([WAZE_STORED])
    expect(printed(spies)).toContain('"link":"gift"')
    expect(printed(spies)).not.toContain('boom')
  })

  it('a guest who opts out after the Waze message does not get the gift template', async () => {
    await tap('wedding_rsvp_attending')
    respond = async (p) => {
      if (!isWaze(p)) return
      const now = new Date()
      await db('whatsapp_opt_outs').insert({
        agencyId: AGENCY,
        customerPhoneE164: `+${GUEST}`,
        status: 'opted_out',
        firstOptedOutAt: now,
        optedOutAt: now,
        lastEventAt: now,
      })
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await answer('4')).toEqual(THANKED)
    expect(graph.filter(isGift)).toHaveLength(0)
  })
})

describe('privacy across the whole flow', () => {
  it('never logs the guest number, token or links, while Meta still receives the full number', async () => {
    const spies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ]
    const connection = await db('whatsapp_connections').where({ phone_number_id: PN }).first()
    const deliver = (message: Record<string, unknown>) =>
      handleInboundWebhookMessage({ message, phoneNumberId: PN, profileName: 'אורח', connection: connection as never })
    const timestamp = String(Math.floor(Date.now() / 1000))

    await deliver({
      id: 'wamid.PRIVACYTAP',
      from: GUEST,
      type: 'button',
      timestamp,
      button: { payload: 'wedding_rsvp_attending', text: 'מגיע/ה' },
    })
    await deliver({ id: 'wamid.PRIVACYCOUNT', from: GUEST, type: 'text', timestamp, text: { body: '4' } })
    await ingestWhatsappStatuses(PN, [{ id: 'wamid.HBgLUNKNOWN', status: 'delivered', timestamp, recipient_id: GUEST }])

    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, ...LINKS])
    const after = graph.slice(-4)
    expect(after.map((p) => p.to)).toEqual([GUEST, GUEST, GUEST, GUEST])
    const logged = JSON.stringify(spies.map((s) => s.mock.calls))
    expect(logged).not.toContain(GUEST)
    expect(logged).not.toContain('test-token')
    expect(logged).not.toContain('test.invalid')
    expect(logged).not.toContain(WAZE)
    expect(logged).not.toContain(PAYBOX)
    expect(logged).not.toContain(BIT)
  })
})

describe('configuration', () => {
  it.each([
    ['Waze missing', undefined],
    ['Waze is http', 'http://waze.test.invalid/ul'],
    ['Waze is not a URL', 'waze'],
    ['Waze is a script URL', 'javascript:alert(1)'],
    ['Waze has no slashes', 'https:waze.test.invalid'],
    ['Waze contains a space', 'https://waze.test.invalid/a b'],
    ['Waze has no host', 'https://'],
  ])('%s: the thank-you is unaffected and nothing partial is sent', async (_name, waze) => {
    if (waze === undefined) delete process.env.WEDDING_WAZE_URL
    else process.env.WEDDING_WAZE_URL = waze
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS])
    expect(await linksRows()).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event links disabled'), { invalid: ['WEDDING_WAZE_URL'] })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('test.invalid')
  })

  it('surrounding whitespace in a configured URL is ignored', async () => {
    process.env.WEDDING_WAZE_URL = ` ${WAZE}\n`
    await tap('wedding_rsvp_attending')
    await answer('4')
    expect(texts().slice(-2)).toEqual(LINKS)
  })
})

describe('a failed links send never affects the RSVP', () => {
  const logged = (spies: Array<{ mock: { calls: unknown[][] } }>) =>
    spies
      .flatMap((s) =>
        s.mock.calls
          .flat()
          .map((a) => (a instanceof Error ? `${a.name} ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))),
      )
      .join('\n')
  const spyAll = () => [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  ]

  it.each([
    ['Meta refuses', () => ({ status: 400, body: { error: { message: 'refused', code: 131047 } } })],
    ['the request times out', () => new Error('timeout')],
  ])('%s: same result, thank-you kept, no links row, no URL logged', async (_name, failure) => {
    await tap('wedding_rsvp_attending')
    respond = (p) => (isWaze(p) ? failure() : undefined)
    const spies = spyAll()
    expect(await answer('4')).toEqual(THANKED)
    expect(await thanksRows()).toHaveLength(1)
    expect(await linksRows()).toHaveLength(0)
    expect(logged(spies)).toContain('event links not sent')
    expect(logged(spies)).not.toContain('test.invalid')
  })

  it('a database error carrying the message text is contained and not logged', async () => {
    await tap('wedding_rsvp_attending')
    h.beforePersist = (input) => {
      if (input.text === WAZE_STORED) throw new Error(`insert into inbox_messages values ('${WAZE}') - boom`)
    }
    const spies = spyAll()
    expect(await answer('4')).toEqual(THANKED)
    expect(await thanksRows()).toHaveLength(1)
    expect(logged(spies)).toContain('event links failed')
    expect(logged(spies)).not.toContain('test.invalid')
  })
})
