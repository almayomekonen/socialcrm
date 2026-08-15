import { describe, expect, it } from 'vitest'
import { resolveWhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-08-16T12:00:00.000Z')

function inboundAgo(ms: number): string {
  return new Date(now.getTime() - ms).toISOString()
}

describe('resolveWhatsappServiceWindow', () => {
  it('A — inbound 2 hours ago → OPEN', () => {
    expect(resolveWhatsappServiceWindow(inboundAgo(2 * HOUR), now)).toBe('OPEN')
  })

  it('B — inbound 23h59m ago → OPEN', () => {
    expect(resolveWhatsappServiceWindow(inboundAgo(23 * HOUR + 59 * 60 * 1000), now)).toBe('OPEN')
  })

  it('C — inbound exactly 24h ago → CLOSED', () => {
    expect(resolveWhatsappServiceWindow(inboundAgo(24 * HOUR), now)).toBe('CLOSED')
  })

  it('C — inbound just over 24h ago → CLOSED', () => {
    expect(resolveWhatsappServiceWindow(inboundAgo(24 * HOUR + 1), now)).toBe('CLOSED')
  })

  it('D — inbound 48h ago → CLOSED', () => {
    expect(resolveWhatsappServiceWindow(inboundAgo(48 * HOUR), now)).toBe('CLOSED')
  })

  it('E — outbound newer than inbound does not affect the window (still CLOSED)', () => {
    // The helper only receives the latest INBOUND timestamp. A newer outbound
    // must not be passed in — outbound does not reset Meta's customer-service window.
    expect(resolveWhatsappServiceWindow(inboundAgo(30 * HOUR), now)).toBe('CLOSED')
  })

  it('F — no inbound message → UNKNOWN', () => {
    expect(resolveWhatsappServiceWindow(null, now)).toBe('UNKNOWN')
    expect(resolveWhatsappServiceWindow(undefined, now)).toBe('UNKNOWN')
    expect(resolveWhatsappServiceWindow('', now)).toBe('UNKNOWN')
  })

  it('invalid inbound timestamp → UNKNOWN (fail closed)', () => {
    expect(resolveWhatsappServiceWindow('not-a-date', now)).toBe('UNKNOWN')
  })
})
