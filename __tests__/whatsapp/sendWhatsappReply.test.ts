import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendWhatsappText = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const recordAccountRestriction = vi.hoisted(() => vi.fn())
const resolveWhatsappOutboundTarget = vi.hoisted(() => vi.fn())
const resolveWhatsappOutboundTargetForConversation = vi.hoisted(() => vi.fn())
const assertWhatsappFreeTextAllowed = vi.hoisted(() => vi.fn())
const requireProductAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/requireUser', () => ({ requireProductAccess }))
vi.mock('@/lib/whatsapp/sendMessage', () => ({ sendWhatsappText }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
vi.mock('@/lib/inbox/recordAccountRestriction', () => ({ recordAccountRestriction }))
vi.mock('@/lib/inbox/whatsappOutboundTarget', () => ({
  resolveWhatsappOutboundTarget,
  resolveWhatsappOutboundTargetForConversation,
}))
vi.mock('@/lib/inbox/whatsappFreeTextGate', () => ({ assertWhatsappFreeTextAllowed }))

import { sendWhatsappReply } from '@/actions/whatsapp/sendWhatsappReply'

beforeEach(() => {
  requireProductAccess.mockResolvedValue({ id: 1, agencyId: 23 })
  assertWhatsappFreeTextAllowed.mockReset()
  assertWhatsappFreeTextAllowed.mockResolvedValue({ ok: true })
  resolveWhatsappOutboundTarget.mockReset()
  resolveWhatsappOutboundTargetForConversation.mockReset()
  resolveWhatsappOutboundTargetForConversation.mockResolvedValue({
    ok: true,
    target: {
      leadId: 9,
      leadName: null,
      businessPhoneNumberId: 'P1',
      accessToken: 't',
      customerWaId: '972500000000',
      customerName: null,
    },
  })
  resolveWhatsappOutboundTarget.mockResolvedValue({
    ok: true,
    target: {
      leadId: 9,
      leadName: null,
      businessPhoneNumberId: 'P1',
      accessToken: 't',
      customerWaId: '972500000000',
      customerName: null,
    },
  })
  persistOutboundWhatsapp.mockReset()
  persistOutboundWhatsapp.mockResolvedValue(undefined)
  recordAccountRestriction.mockReset()
  recordAccountRestriction.mockResolvedValue(undefined)
  sendWhatsappText.mockReset()
})

describe('sendWhatsappReply — error category', () => {
  it('send error 131031 → category account', async () => {
    sendWhatsappText.mockResolvedValue({
      ok: false,
      error: 'Account restricted',
      code: '131031',
      httpStatus: 400,
    })
    const res = await sendWhatsappReply(9, 'שלום')
    expect(res).toEqual({ ok: false, reason: 'send-failed', category: 'account' })
    expect(persistOutboundWhatsapp).not.toHaveBeenCalled()
    expect(recordAccountRestriction).toHaveBeenCalledWith({
      agencyId: 23,
      leadId: 9,
      businessPhoneNumberId: 'P1',
      customerWaId: '972500000000',
      customerName: null,
      sentByUserId: 1,
      text: 'שלום',
    })
  })

  it('transient/generic send failure does NOT record an account restriction', async () => {
    sendWhatsappText.mockResolvedValue({
      ok: false,
      error: 'try again',
      code: '131047',
      httpStatus: 400,
    })
    const res = await sendWhatsappReply(9, 'שלום')
    expect(res).toEqual({ ok: false, reason: 'send-failed', category: 'window_expired' })
    expect(recordAccountRestriction).not.toHaveBeenCalled()
    expect(persistOutboundWhatsapp).not.toHaveBeenCalled()
  })
})

describe('sendWhatsappReply — customer-service window gate', () => {
  it('CLOSED window never reaches Graph free-text send', async () => {
    assertWhatsappFreeTextAllowed.mockResolvedValue({ ok: false, reason: 'window-closed' })
    const res = await sendWhatsappReply(9, 'שלום', 44)
    expect(res).toEqual({ ok: false, reason: 'window-closed' })
    expect(sendWhatsappText).not.toHaveBeenCalled()
    expect(resolveWhatsappOutboundTarget).not.toHaveBeenCalled()
  })

  it('UNKNOWN window never reaches Graph free-text send', async () => {
    assertWhatsappFreeTextAllowed.mockResolvedValue({ ok: false, reason: 'window-unknown' })
    const res = await sendWhatsappReply(9, 'שלום', 44)
    expect(res).toEqual({ ok: false, reason: 'window-unknown' })
    expect(sendWhatsappText).not.toHaveBeenCalled()
  })

  it('restricted health never reaches Graph free-text send', async () => {
    assertWhatsappFreeTextAllowed.mockResolvedValue({ ok: false, reason: 'health-blocked' })
    const res = await sendWhatsappReply(9, 'שלום', 44)
    expect(res).toEqual({ ok: false, reason: 'health-blocked' })
    expect(sendWhatsappText).not.toHaveBeenCalled()
  })

  it('OPEN + conversationId uses the conversation phone, not agency .first()', async () => {
    sendWhatsappText.mockResolvedValue({ ok: true, wamid: 'wamid.1' })
    await sendWhatsappReply(9, 'שלום', 44)
    expect(assertWhatsappFreeTextAllowed).toHaveBeenCalledWith({
      agencyId: 23,
      leadId: 9,
      conversationId: 44,
    })
    expect(resolveWhatsappOutboundTargetForConversation).toHaveBeenCalledWith(23, 9, 44)
    expect(resolveWhatsappOutboundTarget).not.toHaveBeenCalled()
    expect(sendWhatsappText).toHaveBeenCalled()
  })
})
