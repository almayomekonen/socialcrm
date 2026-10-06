import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * sendWeddingInvite + ensureInviteRecipient. No real WhatsApp and no DB: the
 * template sender, persistence, takeover, target resolution, lead/conversation
 * helpers and the invite data module are mocked. The lock mock runs the callback.
 */

const h = vi.hoisted(() => ({
  sendTemplate: vi.fn(),
  persist: vi.fn(),
  takeover: vi.fn(),
  resolveTarget: vi.fn(),
  countInvitesSent: vi.fn(),
  findConversationForWaId: vi.fn(),
  listAgencyPhoneNumberIds: vi.fn(),
  withInviteLock: vi.fn(),
  findClientsByPhoneCore: vi.fn(),
  upsertLead: vi.fn(),
  findOrCreateConversation: vi.fn(),
  attachConversationToLead: vi.fn(),
}))

vi.mock('@/config/db', () => ({ db: { transaction: (fn: (trx: unknown) => unknown) => fn({}) } }))
vi.mock('@/lib/whatsapp/sendTemplateMessage', () => ({ sendWhatsappTemplate: h.sendTemplate }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp: h.persist }))
vi.mock('@/lib/inbox/humanTakeover', () => ({ recordHumanTakeover: h.takeover }))
vi.mock('@/lib/inbox/whatsappOutboundTarget', () => ({ resolveWhatsappOutboundTargetForConversation: h.resolveTarget }))
vi.mock('@/lib/weddingRsvp/inviteData', () => ({
  countInvitesSent: h.countInvitesSent,
  findConversationForWaId: h.findConversationForWaId,
  listAgencyPhoneNumberIds: h.listAgencyPhoneNumberIds,
  withInviteLock: h.withInviteLock,
}))
vi.mock('@/lib/whatsapp/matchLeadByPhone', () => ({ findClientsByPhoneCore: h.findClientsByPhoneCore }))
vi.mock('@/actions/clients', () => ({ upsertLead: h.upsertLead }))
vi.mock('@/db/inboxConversations', () => ({
  findOrCreateConversation: h.findOrCreateConversation,
  attachConversationToLead: h.attachConversationToLead,
}))

const { sendWeddingInvite } = await import('@/lib/weddingRsvp/invite')
const { INVITE_IMAGE_URL, INVITE_STORED_TEXT, INVITE_KIND } = await import('@/lib/weddingRsvp/config')

const AVRAHAM = '972535353219'
const input = { agencyId: 103, userId: 332, phone: '0535353219', firstName: 'אברהם', lastName: 'בוגלה' }
const target = (waId = AVRAHAM) => ({
  ok: true as const,
  target: { leadId: 900, leadName: 'אברהם בוגלה', businessPhoneNumberId: 'PN_1', accessToken: 'tok', wabaId: null, customerWaId: waId, customerName: 'אברהם בוגלה' },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.withInviteLock.mockImplementation(async (_a: number, _w: string, fn: () => Promise<unknown>) => fn())
  h.countInvitesSent.mockResolvedValue(0)
  h.findConversationForWaId.mockResolvedValue(null)
  h.findClientsByPhoneCore.mockResolvedValue([])
  h.upsertLead.mockResolvedValue({ id: 900 })
  h.listAgencyPhoneNumberIds.mockResolvedValue(['PN_1'])
  h.findOrCreateConversation.mockResolvedValue(5000)
  h.resolveTarget.mockResolvedValue(target())
  h.sendTemplate.mockResolvedValue({ ok: true, wamid: 'wamid.invite' })
  h.persist.mockResolvedValue({ conversationId: 5000, messageId: 77, sequence: 1 })
})

describe('sendWeddingInvite — brand-new number', () => {
  it('creates the lead and conversation, takes over, sends the image template once, persists', async () => {
    const r = await sendWeddingInvite(input)
    expect(r).toEqual({
      ok: true,
      wamid: 'wamid.invite',
      messageId: 77,
      conversationId: 5000,
      leadId: 900,
      leadCreated: true,
      conversationCreated: true,
      to: AVRAHAM,
    })
    expect(h.withInviteLock).toHaveBeenCalledWith(103, AVRAHAM, expect.any(Function))
    expect(h.upsertLead).toHaveBeenCalledWith(
      332,
      expect.objectContaining({ firstName: 'אברהם', lastName: 'בוגלה', phone: AVRAHAM, lead: true, status: 'new', userId: 332, handlerId: 332 }),
      null,
      false,
      'manual',
    )
    expect(h.findOrCreateConversation).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ agencyId: 103, leadId: 900, businessPhoneNumberId: 'PN_1', customerWaId: AVRAHAM }),
    )
    expect(h.takeover).toHaveBeenCalledWith({ agencyId: 103, leadId: 900, conversationId: 5000 })
    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
    expect(h.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: AVRAHAM, name: 'wedding_invite', language: 'he', params: [], headerImage: { link: INVITE_IMAGE_URL } }),
    )
    expect(INVITE_IMAGE_URL).toMatch(/^https:\/\/getsocialcrm\.com\/wedding\//)
    expect(h.persist).toHaveBeenCalledWith(
      expect.objectContaining({ wamid: 'wamid.invite', text: INVITE_STORED_TEXT, sentByUserId: 332, metadata: { kind: INVITE_KIND, template: 'wedding_invite' } }),
    )
  })
})

describe('sendWeddingInvite — reuse, never duplicate', () => {
  it('reuses the existing conversation and its lead', async () => {
    h.findConversationForWaId.mockResolvedValue({ id: 4000, leadId: 800, businessPhoneNumberId: 'PN_1' })
    h.resolveTarget.mockResolvedValue({ ...target(), target: { ...target().target, leadId: 800 } })
    const r = await sendWeddingInvite(input)
    expect(r).toMatchObject({ ok: true, conversationId: 4000, leadId: 800, leadCreated: false, conversationCreated: false })
    expect(h.upsertLead).not.toHaveBeenCalled()
    expect(h.findOrCreateConversation).not.toHaveBeenCalled()
    expect(h.attachConversationToLead).not.toHaveBeenCalled()
  })

  it('links a leadless conversation to the single lead with that phone', async () => {
    h.findConversationForWaId.mockResolvedValue({ id: 4000, leadId: null, businessPhoneNumberId: 'PN_1' })
    h.findClientsByPhoneCore.mockResolvedValue([{ id: 801, name: 'א', status: 'new', phone: '0535353219' }])
    await sendWeddingInvite(input)
    expect(h.upsertLead).not.toHaveBeenCalled()
    expect(h.attachConversationToLead).toHaveBeenCalledWith(expect.anything(), { conversationId: 4000, agencyId: 103, leadId: 801 })
  })

  it('uses the existing lead for a new conversation', async () => {
    h.findClientsByPhoneCore.mockResolvedValue([{ id: 801, name: 'א', status: 'new', phone: '0535353219' }])
    const r = await sendWeddingInvite(input)
    expect(r).toMatchObject({ ok: true, leadId: 801, leadCreated: false, conversationCreated: true })
    expect(h.upsertLead).not.toHaveBeenCalled()
  })

  it('refuses when already invited — by template or from the phone — and sends nothing', async () => {
    h.countInvitesSent.mockResolvedValue(1)
    expect(await sendWeddingInvite(input)).toEqual({ ok: false, error: 'already-invited' })
    expect(h.upsertLead).not.toHaveBeenCalled()
    expect(h.sendTemplate).not.toHaveBeenCalled()
  })
})

describe('sendWeddingInvite — refusals send nothing', () => {
  const refuses = async (error: string) => {
    expect(await sendWeddingInvite(input)).toMatchObject({ ok: false, error })
    expect(h.sendTemplate).not.toHaveBeenCalled()
    expect(h.persist).not.toHaveBeenCalled()
  }

  it('invalid / non-mobile / non-allowlisted numbers never reach the DB', async () => {
    expect(await sendWeddingInvite({ ...input, phone: '12345' })).toEqual({ ok: false, error: 'invalid-phone' })
    expect(await sendWeddingInvite({ ...input, phone: '039999999' })).toEqual({ ok: false, error: 'invalid-phone' })
    expect(await sendWeddingInvite({ ...input, phone: '0509319883' })).toEqual({ ok: false, error: 'recipient-not-allowed' })
    expect(await sendWeddingInvite({ ...input, firstName: '  ' })).toEqual({ ok: false, error: 'missing-name' })
    expect(h.withInviteLock).not.toHaveBeenCalled()
    expect(h.sendTemplate).not.toHaveBeenCalled()
  })

  it('two leads with the phone → refuse, never guess', async () => {
    h.findClientsByPhoneCore.mockResolvedValue([
      { id: 1, name: 'a', status: null, phone: null },
      { id: 2, name: 'b', status: null, phone: null },
    ])
    await refuses('ambiguous-lead')
  })

  it('lead creation failure (e.g. quota) → refuse', async () => {
    h.upsertLead.mockResolvedValue({ error: 'quota_exceeded' })
    await refuses('lead-create-failed')
  })

  it('no single connected number → refuse', async () => {
    h.listAgencyPhoneNumberIds.mockResolvedValue(['PN_1', 'PN_2'])
    await refuses('ambiguous-connection')
  })

  it('resolved target that is not allowlisted → refuse', async () => {
    h.resolveTarget.mockResolvedValue(target('972509319883'))
    await refuses('recipient-not-allowed')
  })

  it('Meta rejection → no persist, code surfaced', async () => {
    h.sendTemplate.mockResolvedValue({ ok: false, error: 'Template name does not exist', code: '132001' })
    expect(await sendWeddingInvite(input)).toEqual({ ok: false, error: 'Template name does not exist', code: '132001' })
    expect(h.persist).not.toHaveBeenCalled()
  })
})
