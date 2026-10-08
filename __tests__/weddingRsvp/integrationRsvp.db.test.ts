import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The template-RSVP integration (send-rsvp-request) on the real schema. Meta is
 * MOCKED: `sendWhatsappTemplate` is replaced, so nothing is sent. Lead/conversation
 * lookup, the invitation prerequisite, duplicate protection, the per-guest lock,
 * persistence, replay, status reads and follow-up access all run for real.
 */

const h = vi.hoisted(() => ({ sendTemplate: vi.fn() }))
vi.mock('@/lib/whatsapp/sendTemplateMessage', () => ({ sendWhatsappTemplate: h.sendTemplate }))

const { db } = await import('@/config/db')
const { sendInvitationViaIntegration, invitationStatuses } = await import('@/lib/weddingRsvp/integration')
const { sendRsvpRequestViaIntegration, parseRsvpRequestInput, rsvpRequestStatuses } = await import('@/lib/weddingRsvp/integrationRsvp')
const { followUpAllowed } = await import('@/lib/weddingRsvp/followUpAccess')
const { RSVP_STORED_TEXT } = await import('@/lib/weddingRsvp/config')

const AGENCY = 103
const PN = '__wedding_rsvp_pn'
const GUEST = '972545550011'
const NEW = '972545550012'
const FREEFORM = '972545550013'
const R1 = 'aaaaaaaa-1111-4111-8111-111111111111'
const R2 = 'bbbbbbbb-2222-4222-8222-222222222222'
const INV = (n: number) => `cccccccc-${String(n).padStart(4, '0')}-4333-8333-333333333333`

let userId: number
let agencyCreated = false
let seq = 0

const convIds = async () => (await db('inbox_conversations').where({ agencyId: AGENCY }).whereIn('customerWaId', [GUEST, NEW, FREEFORM]).pluck('id')) as number[]
const convOf = async (wa: string) => db('inbox_conversations').where({ agencyId: AGENCY, customerWaId: wa }).first('id', 'leadId')

async function cleanup() {
  const ids = await convIds()
  await db('inbox_messages').whereIn('conversationId', ids).del()
  await db('conversation_ai_state').whereIn('conversationId', ids).del()
  await db('inbox_participants').whereIn('conversationId', ids).del()
  await db('inbox_conversations').whereIn('id', ids).del()
  await db('clients').where({ agencyId: AGENCY, leadSource: 'wedding_invite' }).del()
}

async function invite(phone: string, n: number) {
  const r = await sendInvitationViaIntegration({ invitationId: INV(n), phone, firstName: 'אורח', lastName: 'בדיקה' })
  expect(r.httpStatus).toBe(200)
}

async function addMessage(wa: string, row: Record<string, unknown>) {
  const conv = await convOf(wa)
  const max = await db('inbox_messages').where({ conversationId: conv.id }).max('sequence as max').first()
  await db('inbox_messages').insert({
    conversationId: conv.id, agencyId: AGENCY, leadId: conv.leadId, channel: 'whatsapp', fromId: wa, toId: PN,
    sequence: (Number(max?.max) || 0) + 1, externalId: `wamid.M${Math.random()}`, rawPayload: JSON.stringify({}), ...row,
  })
}

beforeAll(async () => {
  const existing = await db('agencies').where({ id: AGENCY }).first('id')
  if (!existing) {
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
  seq = 0
  h.sendTemplate.mockReset()
  h.sendTemplate.mockImplementation(async () => ({ ok: true, wamid: `wamid.RSVPTEST${++seq}` }))
})

afterAll(async () => {
  await cleanup()
  await db('whatsapp_connections').where({ phone_number_id: PN }).del()
  await db('users').where({ id: userId }).del()
  if (agencyCreated) await db('agencies').where({ id: AGENCY }).del()
})

const req = (requestId: string, phone = GUEST) => ({ requestId, phone, firstName: 'אורח', lastName: 'בדיקה' })
const rsvpCalls = () => h.sendTemplate.mock.calls.filter((c) => c[0].name === 'wedding_rsvp')

describe('parseRsvpRequestInput — purpose-specific input only', () => {
  it('accepts a UUID + E.164 phone; ignores any template/body/payload the caller adds', () => {
    expect(parseRsvpRequestInput({ ...req(R1), template: 'evil', body: 'x', components: [{}] })).toEqual(req(R1))
    expect(parseRsvpRequestInput({ ...req(R1), requestId: 'nope' })).toBeNull()
    expect(parseRsvpRequestInput({ ...req(R1), phone: '0545550011' })).toBeNull()
    expect(parseRsvpRequestInput(null)).toBeNull()
  })
})

describe('send-rsvp-request over the real schema (Meta mocked)', () => {
  it('refuses a number that was never invited — nothing is sent', async () => {
    const r = await sendRsvpRequestViaIntegration(req(R1, NEW))
    expect(r).toEqual({ httpStatus: 422, body: { accepted: false, error: 'not-invited' } })
    expect(rsvpCalls()).toHaveLength(0)
  })

  it('an invited guest gets exactly the approved wedding_rsvp template with our payloads; stored with the request id', async () => {
    await invite(GUEST, 1)
    const r = await sendRsvpRequestViaIntegration(req(R1))
    expect(r).toEqual({ httpStatus: 200, body: { accepted: true, wamid: 'wamid.RSVPTEST2', status: 'sent', replay: false } })
    expect(rsvpCalls()).toHaveLength(1)
    const arg = rsvpCalls()[0][0]
    expect(arg).toMatchObject({ name: 'wedding_rsvp', language: 'he', params: [], quickReplyPayloads: ['wedding_rsvp_attending', 'wedding_rsvp_not_attending'] })
    expect(arg.headerImage).toBeUndefined()
    const stored = await db('inbox_messages').where({ externalId: 'wamid.RSVPTEST2' }).first('metadata', 'text')
    expect(stored.metadata).toMatchObject({ kind: 'wedding_rsvp_request', template: 'wedding_rsvp', weddingRsvpRequestId: R1 })
    expect(stored.text).toContain('[מגיע/ה] [לצערי לא]')
  })

  it('replay: the same requestId never sends twice; a different id for the same guest is refused', async () => {
    await invite(GUEST, 2)
    await sendRsvpRequestViaIntegration(req(R1))
    const again = await sendRsvpRequestViaIntegration(req(R1))
    expect(again).toMatchObject({ httpStatus: 200, body: { accepted: true, replay: true, wamid: 'wamid.RSVPTEST2' } })
    const other = await sendRsvpRequestViaIntegration(req(R2))
    expect(other).toEqual({ httpStatus: 422, body: { accepted: false, error: 'already-requested' } })
    expect(rsvpCalls()).toHaveLength(1)
  })

  it('concurrent requests for one guest send exactly once (per-guest lock)', async () => {
    await invite(GUEST, 3)
    const out = await Promise.all([sendRsvpRequestViaIntegration(req(R1)), sendRsvpRequestViaIntegration(req(R2))])
    expect(rsvpCalls()).toHaveLength(1)
    expect(out.filter((o) => o.httpStatus === 200)).toHaveLength(1)
  })

  it('a guest who already got the older free-form RSVP counts as already asked', async () => {
    await invite(FREEFORM, 4)
    await addMessage(FREEFORM, { direction: 'outbound', type: 'text', text: RSVP_STORED_TEXT, status: 'delivered', payload: JSON.stringify({}), metadata: JSON.stringify({}) })
    expect(await sendRsvpRequestViaIntegration(req(R1, FREEFORM))).toEqual({ httpStatus: 422, body: { accepted: false, error: 'already-requested' } })
    expect(rsvpCalls()).toHaveLength(0)
  })

  it('a Meta refusal is not persisted and can be retried', async () => {
    await invite(GUEST, 5)
    h.sendTemplate.mockImplementationOnce(async () => ({ ok: false, error: 'Re-engagement message', code: '131047' }))
    expect(await sendRsvpRequestViaIntegration(req(R1))).toEqual({ httpStatus: 422, body: { accepted: false, error: 'Re-engagement message', code: '131047' } })
    expect(await db('inbox_messages').whereRaw(`metadata->>'kind' = 'wedding_rsvp_request'`).first('id')).toBeUndefined()
    expect((await sendRsvpRequestViaIntegration(req(R2))).httpStatus).toBe(200)
  })
})

describe('reads + follow-up access', () => {
  it('reports the RSVP request delivery status by request id', async () => {
    await invite(GUEST, 6)
    await sendRsvpRequestViaIntegration(req(R1))
    await db('inbox_messages').where({ externalId: 'wamid.RSVPTEST2' }).update({ status: 'delivered' })
    const [s] = await rsvpRequestStatuses([{ requestId: R1, externalMessageId: null }])
    expect(s).toMatchObject({ requestId: R1, externalMessageId: 'wamid.RSVPTEST2', status: 'delivered' })
    const [none] = await rsvpRequestStatuses([{ requestId: R2, externalMessageId: null }])
    expect(none.status).toBeNull()
  })

  it('automatic follow-ups are allowed only after a template RSVP request in that conversation', async () => {
    await invite(GUEST, 7)
    const conv = await convOf(GUEST)
    expect(await followUpAllowed(GUEST, conv.id)).toBe(false) // not allowlisted, not asked yet
    await sendRsvpRequestViaIntegration(req(R1))
    expect(await followUpAllowed(GUEST, conv.id)).toBe(true)
  })

  it('a template quick-reply tap (type=button) is read as the structured RSVP', async () => {
    await invite(GUEST, 8)
    await sendRsvpRequestViaIntegration(req(R1))
    await addMessage(GUEST, { direction: 'inbound', type: 'button', text: 'לצערי לא', status: 'received', payload: JSON.stringify({ payload: 'wedding_rsvp_not_attending', text: 'לצערי לא' }), metadata: JSON.stringify({}) })
    const out = await invitationStatuses({ invitations: [], phones: [GUEST] })
    expect(out.rsvp).toEqual([expect.objectContaining({ phone: GUEST, rsvp: 'not_attending', headcount: null })])
  })
})
