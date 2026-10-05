import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Temporary wedding RSVP module. No real WhatsApp: both senders, the DB, target resolution, persistence and takeover are all mocked.
 */

const h = vi.hoisted(() => ({
  convRow: null as Record<string, unknown> | null,
  resolveTarget: vi.fn(),
  persist: vi.fn(),
  takeover: vi.fn(),
  sendText: vi.fn(),
  sendInteractive: vi.fn(),
}))

vi.mock('@/config/db', () => ({
  db: () => ({ where: () => ({ first: async () => h.convRow }) }),
}))
vi.mock('@/lib/inbox/whatsappOutboundTarget', () => ({
  resolveWhatsappOutboundTargetForConversation: h.resolveTarget,
}))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp: h.persist }))
vi.mock('@/lib/inbox/humanTakeover', () => ({ recordHumanTakeover: h.takeover }))
vi.mock('@/lib/weddingRsvp/history', () => ({ findLatestOutbound: vi.fn(), withConversationLock: vi.fn() }))
vi.mock('@/lib/whatsapp/sendMessage', () => ({ sendWhatsappText: h.sendText, sendWhatsappInteractive: h.sendInteractive }))

const { getWeddingRsvpChoice } = await import('@/lib/weddingRsvp/choice')
const { sendWeddingRsvp, RSVP_STORED_TEXT } = await import('@/lib/weddingRsvp/sendRsvp')
const { routeWeddingRsvpReply } = await import('@/lib/weddingRsvp/handleReply')
const { isAllowedRecipient, REPLY_ATTENDING, REPLY_NOT_ATTENDING, RSVP_INTERACTIVE, WEDDING_RSVP_SOURCE } = await import('@/lib/weddingRsvp/config')

const KEREN = '972535316943'
const target = (waId = KEREN) => ({
  ok: true as const,
  target: {
    leadId: 1591,
    leadName: 'Keren',
    businessPhoneNumberId: 'PN_1',
    accessToken: 'tok',
    wabaId: null,
    customerWaId: waId,
    customerName: 'Keren Mekonen',
  },
})
const tap = (id: string) => ({ id: 'wamid.x', from: KEREN, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 't' } } })

beforeEach(() => {
  vi.clearAllMocks()
  h.convRow = { id: 7224, leadId: 1591, customerWaId: KEREN }
  h.resolveTarget.mockResolvedValue(target())
  h.persist.mockResolvedValue({ conversationId: 7224, messageId: 1, sequence: 1 })
  h.sendText.mockResolvedValue({ ok: true, wamid: 'wamid.reply' })
  h.sendInteractive.mockResolvedValue({ ok: true, wamid: 'wamid.rsvp' })
})

describe('allowlist', () => {
  it('accepts Keren in local and E.164 form only', () => {
    expect(isAllowedRecipient('972535316943')).toBe(true)
    expect(isAllowedRecipient('0535316943')).toBe(true)
    expect(isAllowedRecipient('972509319883')).toBe(false)
    expect(isAllowedRecipient(null)).toBe(false)
  })
})

describe('getWeddingRsvpChoice', () => {
  it('maps only our two button ids', () => {
    expect(getWeddingRsvpChoice(tap('wedding_rsvp_attending'))).toBe('attending')
    expect(getWeddingRsvpChoice(tap('wedding_rsvp_not_attending'))).toBe('not_attending')
  })
  it('ignores everything else', () => {
    expect(getWeddingRsvpChoice(tap('some_other_button'))).toBeNull()
    expect(getWeddingRsvpChoice({ type: 'text', text: { body: 'wedding_rsvp_attending' } })).toBeNull()
    expect(getWeddingRsvpChoice({ type: 'button', button: { payload: 'wedding_rsvp_attending' } })).toBeNull()
    expect(getWeddingRsvpChoice({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'wedding_rsvp_attending' } } })).toBeNull()
    expect(getWeddingRsvpChoice(null)).toBeNull()
  })
})

describe('RSVP_INTERACTIVE', () => {
  it('is two reply buttons with stable ids and titles within the 20-char limit', () => {
    expect(RSVP_INTERACTIVE.type).toBe('button')
    expect(RSVP_INTERACTIVE.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'wedding_rsvp_attending', title: 'מגיע/ה' } },
      { type: 'reply', reply: { id: 'wedding_rsvp_not_attending', title: 'לא מגיע/ה' } },
    ])
    for (const b of RSVP_INTERACTIVE.action.buttons) expect(b.reply.title.length).toBeLessThanOrEqual(20)
  })
})

describe('sendWeddingRsvp', () => {
  it('sends once to Keren and persists in the same conversation', async () => {
    const r = await sendWeddingRsvp({ agencyId: 103, conversationId: 7224, sentByUserId: 5 })
    expect(r).toMatchObject({ ok: true, wamid: 'wamid.rsvp', to: KEREN })
    expect(h.sendInteractive).toHaveBeenCalledTimes(1)
    expect(h.sendInteractive).toHaveBeenCalledWith(expect.objectContaining({ to: KEREN, interactive: RSVP_INTERACTIVE }))
    expect(h.takeover).toHaveBeenCalledWith({ agencyId: 103, leadId: 1591, conversationId: 7224 })
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ wamid: 'wamid.rsvp', text: RSVP_STORED_TEXT, sentByUserId: 5 }))
  })
  it('refuses a conversation whose wa_id is not allowlisted, before resolving or sending', async () => {
    h.convRow = { id: 1, leadId: 2, customerWaId: '972509319883' }
    const r = await sendWeddingRsvp({ agencyId: 103, conversationId: 1, sentByUserId: 5 })
    expect(r).toEqual({ ok: false, error: 'recipient-not-allowed' })
    expect(h.resolveTarget).not.toHaveBeenCalled()
    expect(h.sendInteractive).not.toHaveBeenCalled()
  })
  it('refuses when the resolved target differs from the allowlist', async () => {
    h.resolveTarget.mockResolvedValue(target('972509319883'))
    const r = await sendWeddingRsvp({ agencyId: 103, conversationId: 7224, sentByUserId: 5 })
    expect(r).toEqual({ ok: false, error: 'recipient-not-allowed' })
    expect(h.sendInteractive).not.toHaveBeenCalled()
  })
  it('does not persist when Meta rejects (e.g. 24h window closed)', async () => {
    h.sendInteractive.mockResolvedValue({ ok: false, error: 'Re-engagement message', code: '131047' })
    const r = await sendWeddingRsvp({ agencyId: 103, conversationId: 7224, sentByUserId: 5 })
    expect(r).toMatchObject({ ok: false, code: '131047' })
    expect(h.persist).not.toHaveBeenCalled()
  })
})

describe('routeWeddingRsvpReply', () => {
  const base = { agencyId: 103, conversationId: 7224, leadId: 1591, messageId: 50 }

  it('is a no-op for non-wedding messages', async () => {
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: tap('other') })).toEqual({ handled: false })
    expect(h.resolveTarget).not.toHaveBeenCalled()
    expect(h.sendText).not.toHaveBeenCalled()
  })
  it('attending → asks for head count and stores it', async () => {
    const r = await routeWeddingRsvpReply({ ...base, rawMessage: tap('wedding_rsvp_attending') })
    expect(r).toEqual({ handled: true, choice: 'attending', replied: true })
    expect(h.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: KEREN, body: REPLY_ATTENDING }))
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ text: REPLY_ATTENDING, sentByUserId: null, metadata: { step: 'attending', source: WEDDING_RSVP_SOURCE } }))
  })
  it('not attending → thanks', async () => {
    await routeWeddingRsvpReply({ ...base, rawMessage: tap('wedding_rsvp_not_attending') })
    expect(h.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: REPLY_NOT_ATTENDING }))
  })
  it('never replies to a non-allowlisted number', async () => {
    h.resolveTarget.mockResolvedValue(target('972509319883'))
    const r = await routeWeddingRsvpReply({ ...base, rawMessage: tap('wedding_rsvp_attending') })
    expect(r).toMatchObject({ replied: false, reason: 'recipient-not-allowed' })
    expect(h.sendText).not.toHaveBeenCalled()
  })
  it('does not persist a failed send, and never throws', async () => {
    h.sendText.mockResolvedValue({ ok: false, error: 'x', code: '131047' })
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: tap('wedding_rsvp_attending') })).toMatchObject({ replied: false, reason: 'send-failed' })
    expect(h.persist).not.toHaveBeenCalled()
    h.resolveTarget.mockRejectedValue(new Error('db down'))
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: tap('wedding_rsvp_attending') })).toMatchObject({ replied: false, reason: 'error' })
  })
})
