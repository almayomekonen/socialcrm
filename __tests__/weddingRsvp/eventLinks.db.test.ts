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
const { EVENT_LINKS_CLAIM_KEY, EVENT_LINKS_STEP, eventLinkMessages, eventLinkStoredText, sendEventLinksAfterThanks } =
  await import('@/lib/weddingRsvp/eventLinks')
const { handleInboundWebhookMessage } = await import('@/lib/whatsapp/handleInboundWebhookMessage')
const { ingestWhatsappStatuses } = await import('@/lib/inbox/ingestWhatsappStatuses')

const AGENCY = 103
const PN = '__wedding_links_pn'
const GUEST = '972545550021'
const WAZE = 'https://waze.test.invalid/ul?ll=1,2&navigate=yes'
const BIT = 'https://bit.test.invalid/group/private-token'
const [WAZE_MESSAGE, BIT_MESSAGE] = eventLinkMessages({ waze: WAZE, bit: BIT })
const WAZE_STORED = eventLinkStoredText(WAZE_MESSAGE)
const BIT_STORED = eventLinkStoredText(BIT_MESSAGE)
const LINKS = [`CTA:${WAZE}`, `CTA:${BIT}`]

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
  const ids = (await db('inbox_conversations').where({ agencyId: AGENCY, customerWaId: GUEST }).pluck('id')) as number[]
  await db('inbox_messages').whereIn('conversationId', ids).del()
  await db('conversation_ai_state').whereIn('conversationId', ids).del()
  await db('inbox_participants').whereIn('conversationId', ids).del()
  await db('inbox_conversations').whereIn('id', ids).del()
  await db('clients').where({ agencyId: AGENCY, leadSource: 'wedding_invite' }).del()
  await db('whatsapp_opt_outs')
    .where({ agencyId: AGENCY, customerPhoneE164: `+${GUEST}` })
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
  process.env.WEDDING_EVENT_LINKS_TEST_PHONE = GUEST
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
  delete process.env.WEDDING_EVENT_LINKS_TEST_PHONE
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

describe('controlled rollout: only WEDDING_EVENT_LINKS_TEST_PHONE receives the links', () => {
  const OTHER_PHONE = '972545559999'
  const allLogs = () => [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  ]
  const printed = (spies: ReturnType<typeof allLogs>) => JSON.stringify(spies.map((s) => s.mock.calls))

  it.each([
    ['E.164 digits', '972545550021'],
    ['with a plus', '+972545550021'],
    ['Israeli local', '0545550021'],
    ['local with dashes', '054-555-0021'],
    ['international with spaces', '+972 54-555-0021'],
  ])('the configured phone receives the links once: %s', async (_name, configured) => {
    process.env.WEDDING_EVENT_LINKS_TEST_PHONE = configured
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, ...LINKS])
    expect(await claimedRows()).toHaveLength(1)
  })

  it('a different guest gets the normal flow, no links, and keeps their claim', async () => {
    process.env.WEDDING_EVENT_LINKS_TEST_PHONE = OTHER_PHONE
    const spies = allLogs()
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS])
    expect(await linksRows()).toHaveLength(0)
    expect(await claimedRows()).toHaveLength(0)
    expect(printed(spies)).not.toContain(OTHER_PHONE)
  })

  it('a different guest can still receive the links if later made the configured phone', async () => {
    process.env.WEDDING_EVENT_LINKS_TEST_PHONE = OTHER_PHONE
    await tap('wedding_rsvp_attending')
    await answer('4')
    process.env.WEDDING_EVENT_LINKS_TEST_PHONE = GUEST
    await reconfirm()
    expect(linksAttempts()).toBe(1)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['not a number', 'not-a-phone'],
    ['too short', '12345'],
    ['leading zeros prefix', '00972545550021'],
  ])('%s test phone disables the feature safely', async (_name, configured) => {
    if (configured === undefined) delete process.env.WEDDING_EVENT_LINKS_TEST_PHONE
    else process.env.WEDDING_EVENT_LINKS_TEST_PHONE = configured
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS])
    expect(await claimedRows()).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event links disabled'), {
      invalid: ['WEDDING_EVENT_LINKS_TEST_PHONE'],
    })
  })

  it('an invalid test phone is never printed', async () => {
    process.env.WEDDING_EVENT_LINKS_TEST_PHONE = '555-not-valid-555'
    const spies = allLogs()
    await tap('wedding_rsvp_attending')
    await answer('4')
    expect(printed(spies)).not.toContain('not-valid')
  })

  it('a guest outside the test still has the existing decline and head-count behavior', async () => {
    process.env.WEDDING_EVENT_LINKS_TEST_PHONE = OTHER_PHONE
    await tap('wedding_rsvp_attending')
    await answer('4')
    const { rsvp } = await invitationStatuses({ invitations: [], phones: [GUEST] })
    expect(rsvp).toEqual([expect.objectContaining({ phone: GUEST, rsvp: 'attending', headcount: 4 })])
    expect(await answer('4')).toEqual({ handled: false })
    await tap('wedding_rsvp_not_attending')
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS, REPLY_NOT_ATTENDING])
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

  it('sends the exact Cloud API cta_url payloads, Waze first and then Bit', async () => {
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
          body: { text: 'לנוחותכם, ניווט לאירוע 💍' },
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
    ])
  })

  it('stays within Meta limits: labels at most 20 characters, unique, bodies at most 1024', () => {
    const messages = eventLinkMessages({ waze: WAZE, bit: BIT })
    for (const m of messages) {
      expect([...m.label].length).toBeLessThanOrEqual(20)
      expect([...m.body].length).toBeLessThanOrEqual(1024)
    }
    expect(new Set(messages.map((m) => m.label)).size).toBe(2)
  })

  it('persists both messages by the existing conventions, with one claim and no URL in the stored text', async () => {
    await tap('wedding_rsvp_attending')
    await answer('4')
    const rows = await linksRows()
    expect(rows.map((r) => r.text).sort()).toEqual([WAZE_STORED, BIT_STORED].sort())
    for (const row of rows) {
      expect(row).toMatchObject({ sentByUserId: null, status: 'sent' })
      expect(row.metadata).toMatchObject({ source: WEDDING_RSVP_SOURCE, step: EVENT_LINKS_STEP })
      expect(row.text).not.toContain('test.invalid')
    }
    expect(rows.map((r) => r.metadata.link).sort()).toEqual(['bit', 'waze'])
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
    'first message %s: the second is not sent and a re-confirmation sends nothing',
    async (kind) => {
      const spies = quietLogs()
      await tap('wedding_rsvp_attending')
      respond = (p) => (isWaze(p) ? failure(kind) : undefined)
      expect(await answer('4')).toEqual(THANKED)
      expect(graph.filter(isBit)).toHaveLength(0)
      expect(await linksRows()).toHaveLength(0)
      expect(await thanksRows()).toHaveLength(1)
      await reconfirm()
      expect(linksAttempts()).toBe(1)
      expect(graph.filter(isBit)).toHaveLength(0)
      expect(printed(spies)).toContain('"link":"waze"')
      expect(printed(spies)).not.toContain('test.invalid')
    },
  )

  it.each(['refused', 'timed out', 'no id'])(
    'second message %s: the first stays recorded, nothing is retried, the failure names Bit',
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
      expect(printed(spies)).toContain('"link":"bit"')
      expect(printed(spies)).not.toContain('test.invalid')
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
  })

  it('a guest who opts out between the two messages does not get the second', async () => {
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
    expect(after.map((p) => (p as unknown as { to: string }).to)).toEqual([GUEST, GUEST, GUEST, GUEST])
    const logged = JSON.stringify(spies.map((s) => s.mock.calls))
    expect(logged).not.toContain(GUEST)
    expect(logged).not.toContain('test-token')
    expect(logged).not.toContain('test.invalid')
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
  ])('%s: the thank-you is unaffected and nothing partial is sent', async (_name, waze, bit) => {
    if (waze === undefined) delete process.env.WEDDING_WAZE_URL
    else process.env.WEDDING_WAZE_URL = waze
    if (bit === undefined) delete process.env.WEDDING_BIT_URL
    else process.env.WEDDING_BIT_URL = bit
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await tap('wedding_rsvp_attending')
    expect(await answer('4')).toEqual(THANKED)
    expect(texts()).toEqual([REPLY_ATTENDING, REPLY_THANKS])
    expect(await linksRows()).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event links disabled'), expect.anything())
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
