import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Head-count step: "number → thank you", once, only as an answer to OUR question.
 * No real WhatsApp and no DB: the sender, target resolution, persistence and the
 * history/lock module are mocked. The lock mock just runs the callback.
 */

const h = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  persist: vi.fn(),
  sendText: vi.fn(),
  findLatestOutbound: vi.fn(),
  withConversationLock: vi.fn(),
}))

vi.mock('@/lib/inbox/whatsappOutboundTarget', () => ({ resolveWhatsappOutboundTargetForConversation: h.resolveTarget }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp: h.persist }))
vi.mock('@/lib/whatsapp/sendMessage', () => ({ sendWhatsappText: h.sendText }))
vi.mock('@/lib/weddingRsvp/history', () => ({
  findLatestOutbound: h.findLatestOutbound,
  withConversationLock: h.withConversationLock,
}))

const { parseHeadCount, isHeadCountAnswer } = await import('@/lib/weddingRsvp/headCount')
const { routeWeddingRsvpReply } = await import('@/lib/weddingRsvp/handleReply')
const { REPLY_ATTENDING, REPLY_NOT_ATTENDING, REPLY_THANKS, RSVP_STORED_TEXT, WEDDING_RSVP_SOURCE } = await import(
  '@/lib/weddingRsvp/config'
)

const KEREN = '972535316943'
const NOW = new Date('2026-10-05T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
const text = (body: string, from = KEREN) => ({ id: 'wamid.in', from, type: 'text', text: { body } })
const QUESTION = { id: 100, text: REPLY_ATTENDING, source: WEDDING_RSVP_SOURCE, createdAt: minutesAgo(1) }
const THANKS = { id: 102, text: REPLY_THANKS, source: WEDDING_RSVP_SOURCE, createdAt: minutesAgo(0) }

describe('parseHeadCount', () => {
  it('accepts a message that is only a number (optionally + people word)', () => {
    expect(parseHeadCount(text('4'))).toBe(4)
    expect(parseHeadCount(text('  4  '))).toBe(4)
    expect(parseHeadCount(text('4 אנשים'))).toBe(4)
    expect(parseHeadCount(text('12.'))).toBe(12)
    expect(parseHeadCount(text('30'))).toBe(30)
  })
  it('rejects anything else', () => {
    for (const body of ['0', '31', '100', '4 בערב', 'בעוד 4 דקות', 'אנחנו 4', '0535316943', '4,5', 'ארבעה', '😂😂', '']) {
      expect(parseHeadCount(text(body))).toBeNull()
    }
    expect(parseHeadCount({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: '4' } } })).toBeNull()
    expect(parseHeadCount({ type: 'audio' })).toBeNull()
    expect(parseHeadCount(null)).toBeNull()
  })
})

describe('isHeadCountAnswer', () => {
  it('is true only while our head-count question is the latest outbound', () => {
    expect(isHeadCountAnswer(QUESTION, 101, NOW)).toBe(true)
  })
  it('is false once anything else was said to the guest after the question', () => {
    expect(isHeadCountAnswer(THANKS, 103, NOW)).toBe(false) // already thanked → once-only
    expect(isHeadCountAnswer({ ...QUESTION, id: 101, text: 'כמה ילדים יש לך?', source: 'smb_message_echo' }, 102, NOW)).toBe(false)
    expect(isHeadCountAnswer({ ...QUESTION, id: 101, text: 'שלום', source: null }, 102, NOW)).toBe(false) // rep reply
    expect(isHeadCountAnswer({ ...QUESTION, id: 101, text: RSVP_STORED_TEXT, source: null }, 102, NOW)).toBe(false) // new RSVP
    expect(isHeadCountAnswer({ ...QUESTION, id: 101, text: REPLY_NOT_ATTENDING }, 102, NOW)).toBe(false)
    expect(isHeadCountAnswer({ ...QUESTION, source: null }, 101, NOW)).toBe(false) // question text typed by a person
  })
  it('is false with no outbound, for an older inbound, or after the answer window', () => {
    expect(isHeadCountAnswer(null, 101, NOW)).toBe(false)
    expect(isHeadCountAnswer(QUESTION, 99, NOW)).toBe(false)
    expect(isHeadCountAnswer({ ...QUESTION, createdAt: minutesAgo(24 * 60 + 1) }, 101, NOW)).toBe(false)
  })
})

describe('routeWeddingRsvpReply — head count', () => {
  const base = { agencyId: 103, conversationId: 7224, leadId: 1591, messageId: 101 }
  let latest: unknown

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    latest = QUESTION
    h.findLatestOutbound.mockImplementation(async () => latest)
    h.withConversationLock.mockImplementation(async (_id: number, fn: () => Promise<unknown>) => fn())
    h.resolveTarget.mockResolvedValue({
      ok: true,
      target: { leadId: 1591, leadName: 'K', businessPhoneNumberId: 'PN_1', accessToken: 'tok', wabaId: null, customerWaId: KEREN, customerName: 'Keren' },
    })
    h.sendText.mockResolvedValue({ ok: true, wamid: 'wamid.thanks' })
    // Persisting the thank-you makes it the latest outbound, as the DB would.
    h.persist.mockImplementation(async () => {
      latest = THANKS
      return { conversationId: 7224, messageId: 102, sequence: 1 }
    })
  })

  it('sends the thank-you once, under the conversation lock, tagged with the head count', async () => {
    const r = await routeWeddingRsvpReply({ ...base, rawMessage: text('4') })
    expect(r).toEqual({ handled: true, headCount: 4, replied: true })
    expect(h.withConversationLock).toHaveBeenCalledWith(7224, expect.any(Function))
    expect(h.sendText).toHaveBeenCalledTimes(1)
    expect(h.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: KEREN, body: REPLY_THANKS }))
    expect(h.persist).toHaveBeenCalledWith(
      expect.objectContaining({ text: REPLY_THANKS, sentByUserId: null, metadata: { step: 'thanks', headCount: 4, source: WEDDING_RSVP_SOURCE } }),
    )
  })

  it('a second number after the thank-you gets nothing', async () => {
    await routeWeddingRsvpReply({ ...base, rawMessage: text('4') })
    const second = await routeWeddingRsvpReply({ ...base, messageId: 103, rawMessage: text('5') })
    expect(second).toEqual({ handled: false })
    expect(h.sendText).toHaveBeenCalledTimes(1)
  })

  it('an ordinary number in a conversation with no pending question gets nothing', async () => {
    latest = { id: 90, text: 'מתי נפגשים?', source: null, createdAt: minutesAgo(5) }
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: text('3') })).toEqual({ handled: false })
    latest = null
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: text('3') })).toEqual({ handled: false })
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('non-numeric text and non-allowlisted senders never touch the DB', async () => {
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: text('😂😂😂') })).toEqual({ handled: false })
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: text('4', '972509319883') })).toEqual({ handled: false })
    expect(h.withConversationLock).not.toHaveBeenCalled()
    expect(h.findLatestOutbound).not.toHaveBeenCalled()
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('a failed send is not persisted, and a DB error never throws', async () => {
    h.sendText.mockResolvedValue({ ok: false, error: 'x', code: '131047' })
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: text('4') })).toEqual({
      handled: true,
      headCount: 4,
      replied: false,
      reason: 'send-failed',
    })
    expect(h.persist).not.toHaveBeenCalled()
    h.findLatestOutbound.mockRejectedValue(new Error('db down'))
    expect(await routeWeddingRsvpReply({ ...base, rawMessage: text('4') })).toMatchObject({ replied: false, reason: 'error' })
  })
})
