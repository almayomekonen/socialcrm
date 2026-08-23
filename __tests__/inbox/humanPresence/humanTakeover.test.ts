/**
 * WhatsApp Agent — sending is permanent takeover.
 *
 * Typing pauses the agent; the rep pressing send ends its autonomy. The ordering
 * matters as much as the fact: takeover is recorded BEFORE the round trip to
 * Meta, because that round trip is exactly the window a worker could slip a reply
 * through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const markHumanActiveByConversation = vi.hoisted(() => vi.fn())
const recordHumanTakeover = vi.hoisted(() => vi.fn())
const sendWhatsappText = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const requireProductAccess = vi.hoisted(() => vi.fn())
const assertWhatsappFreeTextAllowed = vi.hoisted(() => vi.fn())
const resolveWhatsappOutboundTargetForConversation = vi.hoisted(() => vi.fn())
const resolveWhatsappOutboundTarget = vi.hoisted(() => vi.fn())
const conversationRow = vi.hoisted(() => ({ value: { id: 382 } as unknown }))
const order = vi.hoisted(() => ({ steps: [] as string[] }))

vi.mock('@/db/conversationHumanPresence', () => ({
  markHumanActiveByConversation,
  readHumanPresence: vi.fn(),
  recordHumanTyping: vi.fn(),
}))
vi.mock('@/config/db', () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    const self = () => c
    c.where = self
    c.orderBy = self
    c.orderByRaw = self
    c.first = async () => conversationRow.value
    return c
  }
  return { db: Object.assign(() => chain(), { raw: (sql: string) => sql, fn: { now: () => new Date() } }) }
})

describe('recordHumanTakeover', () => {
  beforeEach(async () => {
    vi.resetModules()
    // The write is agency-scoped in SQL; it reports whether a row was affected.
    markHumanActiveByConversation.mockReset().mockResolvedValue(true)
    conversationRow.value = { id: 382 }
  })

  it('marks the open conversation human_active', async () => {
    const { recordHumanTakeover: fn } = await import('@/lib/inbox/humanTakeover')
    await expect(fn({ agencyId: 103, leadId: 1417, conversationId: 382 })).resolves.toEqual({ conversationId: 382 })
    expect(markHumanActiveByConversation).toHaveBeenCalledWith(382, 103)
  })

  it('falls back to the lead’s newest WhatsApp conversation when none is open', async () => {
    // Lead-page send: the same row resolveWhatsappOutboundTarget would send from,
    // so takeover always lands on the conversation that received the message.
    const { recordHumanTakeover: fn } = await import('@/lib/inbox/humanTakeover')
    await expect(fn({ agencyId: 103, leadId: 1417 })).resolves.toEqual({ conversationId: 382 })
    expect(markHumanActiveByConversation).toHaveBeenCalledWith(382, 103)
  })

  it('reports no takeover when the conversation belongs to another agency', async () => {
    // The SQL sources the row FROM inbox_conversations scoped by agency, so a
    // foreign conversationId affects nothing and comes back false (IDOR-safe).
    markHumanActiveByConversation.mockResolvedValue(false)
    const { recordHumanTakeover: fn } = await import('@/lib/inbox/humanTakeover')
    await expect(fn({ agencyId: 999, leadId: 1417, conversationId: 382 })).resolves.toEqual({ conversationId: null })
    expect(markHumanActiveByConversation).toHaveBeenCalledWith(382, 999)
  })

  it('does nothing when the lead has no WhatsApp conversation at all', async () => {
    conversationRow.value = undefined
    const { recordHumanTakeover: fn } = await import('@/lib/inbox/humanTakeover')
    await expect(fn({ agencyId: 103, leadId: 1417 })).resolves.toEqual({ conversationId: null })
    expect(markHumanActiveByConversation).not.toHaveBeenCalled()
  })

  it('never throws — presence bookkeeping cannot block a rep from replying', async () => {
    markHumanActiveByConversation.mockRejectedValue(new Error('deadlock detected'))
    const { recordHumanTakeover: fn } = await import('@/lib/inbox/humanTakeover')
    await expect(fn({ agencyId: 103, leadId: 1417, conversationId: 382 })).resolves.toEqual({ conversationId: null })
  })
})

describe('sendWhatsappReply', () => {
  beforeEach(() => {
    order.steps = []
    recordHumanTakeover.mockReset().mockImplementation(async () => {
      order.steps.push('takeover')
      return { conversationId: 382 }
    })
    sendWhatsappText.mockReset().mockImplementation(async () => {
      order.steps.push('graph')
      return { ok: true as const, wamid: 'wamid.1' }
    })
    persistOutboundWhatsapp.mockReset().mockResolvedValue({ conversationId: 382, messageId: 1, sequence: 2 })
    requireProductAccess.mockReset().mockResolvedValue({ id: 332, agencyId: 103 })
    assertWhatsappFreeTextAllowed.mockReset().mockResolvedValue({ ok: true })
    resolveWhatsappOutboundTargetForConversation.mockReset().mockResolvedValue({
      ok: true,
      target: {
        leadId: 1417,
        leadName: 'george',
        businessPhoneNumberId: '972007939322425',
        accessToken: 't',
        wabaId: null,
        customerWaId: '972524186300',
        customerName: 'george',
      },
    })
    resolveWhatsappOutboundTarget.mockReset()
  })

  it('marks HUMAN_ACTIVE before the message leaves for Meta', async () => {
    vi.resetModules()
    vi.doMock('@/lib/requireUser', () => ({ requireProductAccess }))
    vi.doMock('@/lib/whatsapp/sendMessage', () => ({ sendWhatsappText }))
    vi.doMock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
    vi.doMock('@/lib/inbox/onWhatsappSendFailure', () => ({ onWhatsappSendFailure: vi.fn() }))
    vi.doMock('@/lib/inbox/whatsappFreeTextGate', () => ({ assertWhatsappFreeTextAllowed }))
    vi.doMock('@/lib/inbox/whatsappOutboundTarget', () => ({
      resolveWhatsappOutboundTargetForConversation,
      resolveWhatsappOutboundTarget,
    }))
    vi.doMock('@/lib/inbox/humanTakeover', () => ({ recordHumanTakeover }))

    const { sendWhatsappReply } = await import('@/actions/whatsapp/sendWhatsappReply')
    await expect(sendWhatsappReply(1417, 'אני חוזר אליך', 382)).resolves.toEqual({ ok: true })

    expect(recordHumanTakeover).toHaveBeenCalledWith({ agencyId: 103, leadId: 1417, conversationId: 382 })
    // The window we are protecting is the round trip itself.
    expect(order.steps).toEqual(['takeover', 'graph'])
  })

  it('a send Meta rejects still leaves the conversation HUMAN_ACTIVE', async () => {
    // The rep is sitting in the composer; they own the conversation whether or
    // not that particular attempt succeeded. Stopping the agent is the safe
    // direction, and the rep can always retry.
    vi.resetModules()
    sendWhatsappText.mockResolvedValue({ ok: false as const, error: 'rate limited', code: '131048' })
    vi.doMock('@/lib/requireUser', () => ({ requireProductAccess }))
    vi.doMock('@/lib/whatsapp/sendMessage', () => ({ sendWhatsappText }))
    vi.doMock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
    vi.doMock('@/lib/inbox/onWhatsappSendFailure', () => ({
      onWhatsappSendFailure: vi.fn(async () => ({ category: 'transient' })),
    }))
    vi.doMock('@/lib/inbox/whatsappFreeTextGate', () => ({ assertWhatsappFreeTextAllowed }))
    vi.doMock('@/lib/inbox/whatsappOutboundTarget', () => ({
      resolveWhatsappOutboundTargetForConversation,
      resolveWhatsappOutboundTarget,
    }))
    vi.doMock('@/lib/inbox/humanTakeover', () => ({ recordHumanTakeover }))

    const { sendWhatsappReply } = await import('@/actions/whatsapp/sendWhatsappReply')
    const res = await sendWhatsappReply(1417, 'אני חוזר אליך', 382)
    expect(res.ok).toBe(false)
    expect(recordHumanTakeover).toHaveBeenCalledTimes(1)
  })

  it('an invalid request never records a takeover', async () => {
    vi.resetModules()
    vi.doMock('@/lib/requireUser', () => ({ requireProductAccess }))
    vi.doMock('@/lib/whatsapp/sendMessage', () => ({ sendWhatsappText }))
    vi.doMock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
    vi.doMock('@/lib/inbox/onWhatsappSendFailure', () => ({ onWhatsappSendFailure: vi.fn() }))
    vi.doMock('@/lib/inbox/whatsappFreeTextGate', () => ({ assertWhatsappFreeTextAllowed }))
    vi.doMock('@/lib/inbox/whatsappOutboundTarget', () => ({
      resolveWhatsappOutboundTargetForConversation,
      resolveWhatsappOutboundTarget,
    }))
    vi.doMock('@/lib/inbox/humanTakeover', () => ({ recordHumanTakeover }))

    const { sendWhatsappReply } = await import('@/actions/whatsapp/sendWhatsappReply')
    await expect(sendWhatsappReply(1417, '   ', 382)).resolves.toEqual({ ok: false, reason: 'empty' })
    expect(recordHumanTakeover).not.toHaveBeenCalled()
  })
})
