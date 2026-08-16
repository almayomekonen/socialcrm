import { describe, expect, it } from 'vitest'
import { inboxAttention, mapInboxRow } from '@/modules/inbox/mapInboxRow'

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)
const H = 3_600_000

const row = (over: Record<string, unknown> = {}) =>
  mapInboxRow(
    {
      conversationId: 9,
      leadId: 4,
      channel: 'whatsapp',
      customerName: 'נועה',
      lastMessageAt: new Date(NOW - H).toISOString(),
      lastInboundAt: new Date(NOW - 7 * H).toISOString(),
      lastHumanOutboundAt: null,
      lastDirection: 'outbound',
      lastMessageText: 'תודה שפנית',
      ...over,
    },
    NOW,
  )

describe('mapInboxRow waiting / needsReply', () => {
  it('inbound newer than human outbound → waiting + needs_reply', () => {
    const item = row({
      lastDirection: 'inbound',
      lastHumanOutboundAt: new Date(NOW - 10 * H).toISOString(),
    })
    expect(item.attention).toBe('needs_reply')
    expect(item.waitingTitle).toBe('ממתין לתשובה שלך · 7 שעות')
    expect(item.waitingWindowHint).toBe('נותרו 17 שעות בחלון WhatsApp')
  })

  it('human outbound newer → not waiting, replied', () => {
    const item = row({
      lastInboundAt: new Date(NOW - 10 * H).toISOString(),
      lastHumanOutboundAt: new Date(NOW - 2 * H).toISOString(),
      lastDirection: 'outbound',
    })
    expect(item.attention).toBe('replied')
    expect(item.waitingTitle).toBeNull()
    expect(item.waitingWindowHint).toBeNull()
  })

  it('IRE acknowledgement does NOT clear waiting (outbound lastDirection, no human outbound)', () => {
    const item = row({ lastDirection: 'outbound', lastHumanOutboundAt: null })
    expect(item.attention).toBe('needs_reply')
    expect(item.waitingTitle).toContain('ממתין לתשובה שלך')
  })

  it('no outbound → waiting', () => {
    const item = row({ lastDirection: 'inbound', lastHumanOutboundAt: null })
    expect(item.attention).toBe('needs_reply')
  })

  it('no inbound → not waiting', () => {
    const item = row({ lastInboundAt: null, lastDirection: null, lastHumanOutboundAt: null })
    expect(item.attention).toBeNull()
    expect(item.waitingTitle).toBeNull()
  })

  it('CLOSED window copy is attached', () => {
    const item = row({ lastInboundAt: new Date(NOW - 30 * H).toISOString() })
    expect(item.waitingWindowHint).toBe('חלון WhatsApp נסגר')
  })

  it('leadless conversations can still be waiting, but stay non-sendable at the composer', () => {
    const item = row({ leadId: null })
    expect(item.leadId).toBeNull()
    expect(item.attention).toBe('needs_reply')
  })

  it('invalid timestamps fail safely', () => {
    expect(inboxAttention({ lastInboundAt: 'bad', lastHumanOutboundAt: null, lastDirection: 'inbound', nowMs: NOW })).toBeNull()
  })
})
