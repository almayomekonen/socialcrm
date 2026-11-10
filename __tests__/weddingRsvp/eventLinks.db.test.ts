import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The event-links message on the real schema, through the real webhook route, lock,
 * eligibility check and opt-out gate. Only the network is replaced: `fetch` is stubbed,
 * so nothing can reach Meta.
 */

type Cta = { type: string; body: { text: string }; action: { name: string; parameters: { display_text: string; url: string } } }
type Payload = { type: string; text?: { body: string; preview_url: boolean }; interactive?: Cta }
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
const BIT = 'https://bit.test.invalid/group/private-token'
const PAYBOX = 'https://links.payboxapp.com/EvZawEB4W7b'
const [WAZE_MESSAGE, BIT_MESSAGE, PAYBOX_MESSAGE] = eventLinkMessages({ waze: WAZE, bit: BIT, paybox: PAYBOX })
const WAZE_STORED = eventLinkStoredText(WAZE_MESSAGE)
const BIT_STORED = eventLinkStoredText(BIT_MESSAGE)
const PAYBOX_STORED = eventLinkStoredText(PAYBOX_MESSAGE)
const LINKS = [`CTA:${WAZE}`, `CTA:${BIT}`, `CTA:${PAYBOX}`]

let userId: number
let agencyCreated = false
let wamid = 0
let conversationId: number
let leadId: number
let graph: Payload[]
let respond: (p: Payload) => Promise<Reply> | Reply

const ctaUrl = (p: Payload) => p.interactive?.action.parameters.url
/** Everything sent after the RSVP template, in order: text bodies, and each CTA by its URL. */
const texts = () => graph.filter((p) => p.type !== 'template').map((p) => (p.type === 'text' ? p.text!.body : `CTA:${ctaUrl(p)}`))
const isWaze = (p: Payload) => ctaUrl(p) === WAZE
const isBit = (p: Payload) => ctaUrl(p) === BIT
const isPaybox = (p: Payload) => ctaUrl(p) === PAYBOX
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
  process.env.WEDDING_BIT_URL = BIT
  process.env.WEDDING_PAYBOX_URL = PAYBOX
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
  delete process.env.WEDDING_BIT_URL
  delete process.env.WEDDING_PAYBOX_URL
  delete process.env.WEDDING_EVENT_LINKS_TEST_PHONE // only set by the stale-config test
})

afterAll(async () => {
  await cleanup()
  await db('whatsapp_connections').where({ phone_number_id: PN }).del()
  await db('users').where({ id: userId }).del()
  if (agencyCreated) await db('agencies').where({ id: AGENCY }).del()
})

describe('the links follow a successful thank-you', () => {
  it('sends both CTA messages after the thank-you, without changing the RSVP result', async () => {
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)

    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, ...LINKS])
    expect(await linksRows()).toHaveLength(3)
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
    process.env.WEDDING_BIT_URL = 'http://bit.test.invalid/x'
    await tap('wedding_rsvp_attending')
    await answer('4')
    expect(await claimedRows()).toHaveLength(0)
    expect(linksAttempts()).toBe(0)

    process.env.WEDDING_BIT_URL = BIT
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
    graph.filter((p) => p.type === 'interactive' && (p as unknown as { to: string }).to === phone).map((p) => `CTA:${ctaUrl(p)}`)

  it('needs no test-phone variable: only the two URLs are required configuration', () => {
    delete process.env.WEDDING_EVENT_LINKS_TEST_PHONE
    expect(readEventLinks()).toEqual({ links: { waze: WAZE, bit: BIT, paybox: PAYBOX }, invalid: [] })
    delete process.env.WEDDING_WAZE_URL
    delete process.env.WEDDING_BIT_URL
    delete process.env.WEDDING_PAYBOX_URL
    expect(readEventLinks()).toEqual({
      links: null,
      invalid: ['WEDDING_WAZE_URL', 'WEDDING_BIT_URL', 'WEDDING_PAYBOX_URL'],
    })
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

describe('the two CTA URL messages', () => {
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

  it('sends the exact Cloud API cta_url payloads: Waze, then the Bit and PayBox gift options', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const ctas = graph.filter((p) => p.type === 'interactive')
    expect(ctas).toEqual([
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
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: 'למי שרוצה לשלוח מתנה 💝' },
          action: { name: 'cta_url', parameters: { display_text: 'שליחת מתנה ב-Bit', url: BIT } },
        },
      },
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: GUEST,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: 'השימוש ב-PayBox חינם!\nמחכים לך בקבוצת ״מתנה לחתונה A | F״,\nלחיצה להצטרפות לקבוצה:' },
          action: {
            name: 'cta_url',
            parameters: { display_text: 'הצטרפות ב-PayBox', url: 'https://links.payboxapp.com/EvZawEB4W7b' },
          },
        },
      },
    ])
  })

  it('stays within Meta limits: labels at most 20 characters, unique, bodies at most 1024', () => {
    const messages = eventLinkMessages({ waze: WAZE, bit: BIT, paybox: PAYBOX })
    for (const m of messages) {
      expect([...m.label].length).toBeLessThanOrEqual(20)
      expect([...m.body].length).toBeLessThanOrEqual(1024)
    }
    expect(new Set(messages.map((m) => m.label)).size).toBe(3)
    expect(messages.map((m) => m.link)).toEqual(['waze', 'bit', 'paybox'])
  })

  it('persists all three messages by the existing conventions, with one claim and no URL in the stored text', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const rows = await linksRows()
    expect(rows.map((r) => r.text).sort()).toEqual([WAZE_STORED, BIT_STORED, PAYBOX_STORED].sort())
    for (const row of rows) {
      expect(row).toMatchObject({ sentByUserId: null, status: 'sent' })
      expect(row.metadata).toMatchObject({ source: WEDDING_RSVP_SOURCE, step: EVENT_LINKS_STEP })
      expect(row.text).not.toContain('test.invalid')
      expect(row.text).not.toContain(PAYBOX)
    }
    expect(rows.map((r) => r.metadata.link).sort()).toEqual(['bit', 'paybox', 'waze'])
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
    'first message %s: the gift messages are not sent and a re-confirmation sends nothing',
    async (kind) => {
      const spies = quietLogs()
      await tap('wedding_rsvp_attending')
      respond = (p) => (isWaze(p) ? failure(kind) : undefined)
      expect(await answer('4')).toEqual(THANKED)
      expect(graph.filter(isBit)).toHaveLength(0)
      expect(graph.filter(isPaybox)).toHaveLength(0)
      expect(await linksRows()).toHaveLength(0)
      expect(await thanksRows()).toHaveLength(1)
      await reconfirm()
      expect(linksAttempts()).toBe(1)
      expect(graph.filter(isBit)).toHaveLength(0)
      expect(graph.filter(isPaybox)).toHaveLength(0)
      expect(printed(spies)).toContain('"link":"waze"')
      expect(printed(spies)).not.toContain('test.invalid')
    },
  )

  it.each(['refused', 'timed out', 'no id'])(
    'second message %s: Waze stays recorded, PayBox is not sent, nothing is retried, the failure names Bit',
    async (kind) => {
      const spies = quietLogs()
      await tap('wedding_rsvp_attending')
      respond = (p) => (isBit(p) ? failure(kind) : undefined)
      expect(await answer('4')).toEqual(THANKED)
      expect((await linksRows()).map((r) => r.text)).toEqual([WAZE_STORED])
      expect(await thanksRows()).toHaveLength(1)
      await reconfirm()
      expect(linksAttempts()).toBe(1)
      expect(graph.filter(isBit)).toHaveLength(1)
      expect(graph.filter(isPaybox)).toHaveLength(0)
      expect(printed(spies)).toContain('"link":"bit"')
      expect(printed(spies)).not.toContain('test.invalid')
    },
  )

  it.each(['refused', 'timed out', 'no id'])(
    'third message %s: Waze and Bit stay recorded, nothing is retried, the failure names PayBox',
    async (kind) => {
      const spies = quietLogs()
      await tap('wedding_rsvp_attending')
      respond = (p) => (isPaybox(p) ? failure(kind) : undefined)
      expect(await answer('4')).toEqual(THANKED)
      expect((await linksRows()).map((r) => r.text).sort()).toEqual([WAZE_STORED, BIT_STORED].sort())
      await reconfirm()
      expect(linksAttempts()).toBe(1)
      expect(graph.filter(isPaybox)).toHaveLength(1)
      expect(printed(spies)).toContain('"link":"paybox"')
      expect(printed(spies)).not.toContain(PAYBOX)
    },
  )

  it('a failed save of the second message is contained and names Bit', async () => {
    const spies = quietLogs()
    await tap('wedding_rsvp_attending')
    h.beforePersist = (input) => {
      if (input.text === BIT_STORED) throw new Error(`insert ... ('${BIT}') - boom`)
    }
    expect(await answer('4')).toEqual(THANKED)
    expect((await linksRows()).map((r) => r.text)).toEqual([WAZE_STORED])
    expect(printed(spies)).toContain('"link":"bit"')
    expect(printed(spies)).not.toContain('test.invalid')
    expect(graph.filter(isPaybox)).toHaveLength(0)
  })

  it('a guest who opts out after the Waze message gets neither gift message', async () => {
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
    expect(graph.filter(isBit)).toHaveLength(0)
    expect(graph.filter(isPaybox)).toHaveLength(0)
  })

  it('a guest who opts out after the Bit message does not get PayBox', async () => {
    await tap('wedding_rsvp_attending')
    respond = async (p) => {
      if (!isBit(p)) return
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
    expect(graph.filter(isBit)).toHaveLength(1)
    expect(graph.filter(isPaybox)).toHaveLength(0)
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
    const after = graph.slice(-5)
    expect(after.map((p) => (p as unknown as { to: string }).to)).toEqual([GUEST, GUEST, GUEST, GUEST, GUEST])
    const logged = JSON.stringify(spies.map((s) => s.mock.calls))
    expect(logged).not.toContain(GUEST)
    expect(logged).not.toContain('test-token')
    expect(logged).not.toContain('test.invalid')
    expect(logged).not.toContain(WAZE)
    expect(logged).not.toContain(PAYBOX)
  })
})

describe('configuration', () => {
  it.each([
    ['both missing', undefined, undefined],
    ['Waze missing', undefined, BIT],
    ['Bit missing', WAZE, undefined],
    ['Waze is http', 'http://waze.test.invalid/ul', BIT],
    ['Bit is http', WAZE, 'http://bit.test.invalid/x'],
    ['Waze is not a URL', 'waze', BIT],
    ['Bit is a script URL', WAZE, 'javascript:alert(1)'],
    ['Waze has no slashes', 'https:waze.test.invalid', BIT],
    ['Bit contains a space', WAZE, 'https://bit.test.invalid/a b'],
    ['Waze has no host', 'https://', BIT],
    ['PayBox missing', WAZE, BIT, null],
    ['PayBox is http', WAZE, BIT, 'http://links.payboxapp.com/EvZawEB4W7b'],
    ['PayBox has a space', WAZE, BIT, 'https://links.payboxapp.com/a b'],
  ])('%s: the thank-you is unaffected and nothing partial is sent', async (_name, waze, bit, paybox?: string | null) => {
    if (waze === undefined) delete process.env.WEDDING_WAZE_URL
    else process.env.WEDDING_WAZE_URL = waze
    if (bit === undefined) delete process.env.WEDDING_BIT_URL
    else process.env.WEDDING_BIT_URL = bit
    if (paybox === null) delete process.env.WEDDING_PAYBOX_URL
    else if (paybox !== undefined) process.env.WEDDING_PAYBOX_URL = paybox
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS])
    expect(await linksRows()).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event links disabled'), expect.anything())
    expect(JSON.stringify(warn.mock.calls)).not.toContain('test.invalid')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('payboxapp')
  })

  it('surrounding whitespace in a configured URL is ignored', async () => {
    process.env.WEDDING_WAZE_URL = ` ${WAZE}\n`
    await tap('wedding_rsvp_attending')
    await answer('4')
    expect(texts().slice(-3)).toEqual(LINKS)
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
