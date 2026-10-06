import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Wedding Manager integration on the real schema. Meta is MOCKED: the only
 * network-facing call (`sendWhatsappTemplate`) is replaced, so nothing is sent.
 * Everything else — lead/conversation creation, takeover, persistence, replay,
 * status and RSVP reads, the backfill export — runs for real.
 */

const h = vi.hoisted(() => ({ sendTemplate: vi.fn() }))
vi.mock('@/lib/whatsapp/sendTemplateMessage', () => ({ sendWhatsappTemplate: h.sendTemplate }))

const { db } = await import('@/config/db')
const { sendInvitationViaIntegration, invitationStatuses, parseSendInput } = await import('@/lib/weddingRsvp/integration')
const { exportInvitedGuests } = await import('@/lib/weddingRsvp/integrationExport')

const AGENCY = 103 // WEDDING_AGENCY_ID
const PN = '__wedding_integration_pn'
const GUEST = '972545550001'
const OTHER = '972545550002'
const PHONE_GUEST = '972545550003'
const INV_1 = '11111111-1111-4111-8111-111111111111'
const INV_2 = '22222222-2222-4222-8222-222222222222'

let userId: number
let agencyCreated = false
let wamidSeq = 0

const convIds = async () =>
  (await db('inbox_conversations').where({ agencyId: AGENCY }).whereIn('customerWaId', [GUEST, OTHER, PHONE_GUEST]).pluck('id')) as number[]

async function cleanup() {
  const ids = await convIds()
  await db('inbox_messages').whereIn('conversationId', ids).del()
  await db('conversation_ai_state').whereIn('conversationId', ids).del()
  await db('inbox_participants').whereIn('conversationId', ids).del()
  await db('inbox_conversations').whereIn('id', ids).del()
  await db('clients').where({ agencyId: AGENCY, leadSource: 'wedding_invite' }).del()
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
  wamidSeq = 0
  h.sendTemplate.mockReset()
  h.sendTemplate.mockImplementation(async () => ({ ok: true, wamid: `wamid.TEST${++wamidSeq}` }))
})

afterAll(async () => {
  await cleanup()
  await db('whatsapp_connections').where({ phone_number_id: PN }).del()
  await db('users').where({ id: userId }).del()
  if (agencyCreated) await db('agencies').where({ id: AGENCY }).del()
})

const input = (invitationId: string, phone = GUEST) => ({ invitationId, phone, firstName: 'נדב', lastName: 'גטהון' })

describe('parseSendInput', () => {
  it('requires a UUID, an E.164 phone and a first name', () => {
    expect(parseSendInput(input(INV_1))).toEqual(input(INV_1))
    expect(parseSendInput({ ...input(INV_1), invitationId: 'not-a-uuid' })).toBeNull()
    expect(parseSendInput({ ...input(INV_1), phone: '0545550001' })).toBeNull()
    expect(parseSendInput({ ...input(INV_1), firstName: ' ' })).toBeNull()
    expect(parseSendInput(null)).toBeNull()
  })
})

describe('send-invitation over the real schema (Meta mocked)', () => {
  it('a new number: creates lead + conversation, sends once, stores the correlation id', async () => {
    const r = await sendInvitationViaIntegration(input(INV_1))
    expect(r).toEqual({ httpStatus: 200, body: { accepted: true, wamid: 'wamid.TEST1', status: 'sent', replay: false } })
    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
    const msg = await db('inbox_messages').where({ externalId: 'wamid.TEST1' }).first('metadata', 'sentByUserId')
    expect(msg.metadata).toMatchObject({ kind: 'wedding_invite', weddingInvitationId: INV_1 })
    expect(Number(msg.sentByUserId)).toBe(userId)
    const lead = await db('clients').where({ agencyId: AGENCY, leadSource: 'wedding_invite', phone: GUEST }).first('status', 'userId', 'handlerId')
    expect(lead).toMatchObject({ status: 'new', userId, handlerId: userId })
    const conv = await db('inbox_conversations').where({ agencyId: AGENCY, customerWaId: GUEST }).first('id')
    expect((await db('conversation_ai_state').where({ conversationId: conv.id }).first('aiState')).aiState).toBe('human_active')
  })

  it('a replay of the SAME invitation id returns the original wamid and sends nothing', async () => {
    await sendInvitationViaIntegration(input(INV_1))
    const again = await sendInvitationViaIntegration(input(INV_1))
    expect(again).toEqual({ httpStatus: 200, body: { accepted: true, wamid: 'wamid.TEST1', status: 'sent', replay: true } })
    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
  })

  it('a DIFFERENT invitation id for an already-invited phone is refused (existing duplicate protection)', async () => {
    await sendInvitationViaIntegration(input(INV_1))
    const second = await sendInvitationViaIntegration(input(INV_2))
    expect(second).toEqual({ httpStatus: 422, body: { accepted: false, error: 'already-invited' } })
    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
  })

  it('parallel duplicates of one invitation send exactly once', async () => {
    const results = await Promise.all([sendInvitationViaIntegration(input(INV_1)), sendInvitationViaIntegration(input(INV_1))])
    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r.httpStatus === 200)).toBe(true)
    expect(new Set(results.map((r) => ('wamid' in r.body ? r.body.wamid : null)))).toEqual(new Set(['wamid.TEST1']))
  })

  it('a Meta rejection is reported and persists nothing; a retry with a new id may send', async () => {
    h.sendTemplate.mockResolvedValueOnce({ ok: false, error: 'payment', code: '131042' })
    expect(await sendInvitationViaIntegration(input(INV_1))).toEqual({ httpStatus: 422, body: { accepted: false, error: 'payment', code: '131042' } })
    expect(await db('inbox_messages').whereRaw(`metadata->>'weddingInvitationId' = ?`, [INV_1]).first()).toBeUndefined()
    expect(await sendInvitationViaIntegration(input(INV_2))).toMatchObject({ httpStatus: 200 })
  })

  it('an unconfigured acting user disables sending (503) before anything happens', async () => {
    const saved = process.env.WEDDING_INTEGRATION_USER_ID
    process.env.WEDDING_INTEGRATION_USER_ID = ''
    expect(await sendInvitationViaIntegration(input(INV_1))).toMatchObject({ httpStatus: 503 })
    process.env.WEDDING_INTEGRATION_USER_ID = saved
    expect(h.sendTemplate).not.toHaveBeenCalled()
  })
})

describe('invitation-statuses + RSVP', () => {
  it('reports the stored status by invitation id, and by wamid for backfilled invitations', async () => {
    await sendInvitationViaIntegration(input(INV_1))
    await db('inbox_messages')
      .where({ externalId: 'wamid.TEST1' })
      .update({ status: 'delivered', metadata: db.raw(`metadata || '{"delivery":{"deliveredAt":"2026-10-06T08:00:00.000Z"}}'::jsonb`) })
    const out = await invitationStatuses({
      invitations: [
        { invitationId: INV_1, externalMessageId: null },
        { invitationId: INV_2, externalMessageId: 'wamid.TEST1' },
        { invitationId: '33333333-3333-4333-8333-333333333333', externalMessageId: null },
      ],
      phones: [],
    })
    expect(out.invitations[0]).toMatchObject({ status: 'delivered', externalMessageId: 'wamid.TEST1', deliveredAt: '2026-10-06T08:00:00.000Z' })
    expect(out.invitations[1]).toMatchObject({ status: 'delivered', externalMessageId: 'wamid.TEST1' })
    expect(out.invitations[2]).toMatchObject({ status: null })
  })

  it('RSVP: the latest wedding tap, with the head count from the thank-you that followed it', async () => {
    await sendInvitationViaIntegration(input(INV_1))
    const conv = await db('inbox_conversations').where({ agencyId: AGENCY, customerWaId: GUEST }).first('id', 'leadId')
    const add = async (row: Record<string, unknown>) => {
      const max = await db('inbox_messages').where({ conversationId: conv.id }).max<{ max: string | null }>('sequence as max').first()
      await db('inbox_messages').insert({
        conversationId: conv.id,
        agencyId: AGENCY,
        leadId: conv.leadId,
        channel: 'whatsapp',
        fromId: GUEST,
        toId: PN,
        sequence: (Number(max?.max) || 0) + 1,
        externalId: `wamid.R${Math.random()}`,
        rawPayload: JSON.stringify({}),
        ...row,
      })
    }
    await add({ direction: 'inbound', type: 'interactive', text: 'מגיע/ה', status: 'received', payload: JSON.stringify({ type: 'button_reply', button_reply: { id: 'wedding_rsvp_attending', title: 'מגיע/ה' } }), metadata: JSON.stringify({}) })
    await add({ direction: 'outbound', type: 'text', text: 'תודה רבה ❤️ נתראה בחתונה!', status: 'sent', payload: JSON.stringify({}), metadata: JSON.stringify({ source: 'wedding_rsvp', step: 'thanks', headCount: 4 }) })
    const out = await invitationStatuses({ invitations: [], phones: [GUEST, OTHER] })
    expect(out.rsvp).toHaveLength(1)
    expect(out.rsvp[0]).toMatchObject({ phone: GUEST, rsvp: 'attending', headcount: 4 })
  })
})

describe('invited-guests export (read-only)', () => {
  it('lists template sends AND phone-sent invites, one row per phone, with name provenance', async () => {
    await sendInvitationViaIntegration(input(INV_1))
    // A phone-sent invite (Coexistence echo): image with the invite caption, no lead.
    const [conv] = await db('inbox_conversations')
      .insert({ agencyId: AGENCY, leadId: null, channel: 'whatsapp', businessPhoneNumberId: PN, customerWaId: PHONE_GUEST, customerName: 'שי' })
      .returning('id')
    await db('inbox_messages').insert({
      conversationId: conv.id,
      agencyId: AGENCY,
      leadId: null,
      channel: 'whatsapp',
      direction: 'outbound',
      type: 'image',
      text: '',
      status: 'read',
      fromId: PN,
      toId: PHONE_GUEST,
      sequence: 1,
      externalId: 'wamid.ECHO1',
      payload: JSON.stringify({ caption: 'שמחים ונרגשים להזמינכם לחגוג איתנו את היום המאושר בחיינו' }),
      rawPayload: JSON.stringify({}),
      metadata: JSON.stringify({ source: 'smb_message_echo' }),
    })
    const out = (await exportInvitedGuests()).filter((g) => [GUEST, PHONE_GUEST].includes(g.phone))
    expect(out).toHaveLength(2)
    expect(out.find((g) => g.phone === GUEST)).toMatchObject({ name: 'נדב גטהון', nameSource: 'lead', status: 'sent', wamid: 'wamid.TEST1', via: 'template' })
    expect(out.find((g) => g.phone === PHONE_GUEST)).toMatchObject({ name: 'שי', nameSource: 'whatsapp_profile', status: 'read', wamid: 'wamid.ECHO1', via: 'phone' })
  })
})
