import { describe, expect, it } from 'vitest'
import { inboxWaitingTitle, waitingReplyCopy } from '@/lib/inbox/waitingReplyCopy'
import { WHATSAPP_SERVICE_WINDOW_MS } from '@/lib/inbox/whatsappServiceWindow'

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)
const H = 3_600_000

describe('waitingReplyCopy', () => {
  it('OPEN window → remaining time shown, no live countdown', () => {
    const copy = waitingReplyCopy({
      lastInboundAt: NOW - 7 * H,
      lastHumanOutboundAt: null,
      nowMs: NOW,
      channel: 'whatsapp',
    })
    expect(copy?.window).toBe('OPEN')
    expect(copy?.waitingFor).toBe('ממתין 7 שעות')
    expect(copy?.windowHint).toBe('נותרו 17 שעות בחלון WhatsApp')
    expect(inboxWaitingTitle(copy!)).toBe('ממתין לתשובה שלך · 7 שעות')
    expect(copy?.windowHint).not.toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('CLOSED window → closed state shown', () => {
    const copy = waitingReplyCopy({
      lastInboundAt: NOW - 30 * H,
      lastHumanOutboundAt: null,
      nowMs: NOW,
      channel: 'whatsapp',
    })
    expect(copy?.window).toBe('CLOSED')
    expect(copy?.windowHint).toBe('חלון WhatsApp נסגר')
    expect(inboxWaitingTitle(copy!)).toBe('ממתין לתשובה שלך · יום')
  })

  it('24h boundary: just inside is OPEN, exactly 24h is CLOSED', () => {
    const open = waitingReplyCopy({
      lastInboundAt: NOW - WHATSAPP_SERVICE_WINDOW_MS + 1,
      lastHumanOutboundAt: null,
      nowMs: NOW,
      channel: 'whatsapp',
    })
    const closed = waitingReplyCopy({
      lastInboundAt: NOW - WHATSAPP_SERVICE_WINDOW_MS,
      lastHumanOutboundAt: null,
      nowMs: NOW,
      channel: 'whatsapp',
    })
    expect(open?.window).toBe('OPEN')
    expect(open?.windowHint).toMatch(/נותרו/)
    expect(closed?.window).toBe('CLOSED')
    expect(closed?.windowHint).toBe('חלון WhatsApp נסגר')
  })

  it('human outbound newer → no waiting copy', () => {
    expect(
      waitingReplyCopy({
        lastInboundAt: NOW - 5 * H,
        lastHumanOutboundAt: NOW - 2 * H,
        nowMs: NOW,
        channel: 'whatsapp',
      }),
    ).toBeNull()
  })

  it('IRE acknowledgement does not clear waiting copy', () => {
    const copy = waitingReplyCopy({
      lastInboundAt: NOW - 3 * H,
      lastHumanOutboundAt: null,
      nowMs: NOW,
      channel: 'whatsapp',
    })
    expect(copy?.title).toBe('ממתין לתשובה שלך')
  })

  it('no inbound / invalid timestamps / non-WhatsApp → no copy', () => {
    expect(waitingReplyCopy({ lastInboundAt: null, lastHumanOutboundAt: null, nowMs: NOW, channel: 'whatsapp' })).toBeNull()
    expect(
      waitingReplyCopy({ lastInboundAt: 'bad', lastHumanOutboundAt: null, nowMs: NOW, channel: 'whatsapp' }),
    ).toBeNull()
    expect(
      waitingReplyCopy({
        lastInboundAt: NOW - H,
        lastHumanOutboundAt: null,
        nowMs: NOW,
        channel: 'facebook',
      }),
    ).toBeNull()
  })
})
