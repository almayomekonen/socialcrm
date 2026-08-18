import { describe, it, expect } from 'vitest'
import { composeRecentInboundAnswer, formatInboundAgo } from '@/lib/copilot/general/recentInboundCopy'

const NOW = Date.parse('2026-08-18T13:19:00.000Z')

describe('composeRecentInboundAnswer — recency only, not waiting', () => {
  it('lists recent WhatsApp senders by name and recency', () => {
    const text = composeRecentInboundAnswer(
      [
        { name: 'George', at: '2026-08-18T13:17:00.000Z' },
        { name: 'ספי ברהנה', at: '2026-08-18T13:01:00.000Z' },
      ],
      NOW,
    )
    expect(text).toContain('George — לפני 2 דקות')
    expect(text).toContain('ספי ברהנה — לפני 18 דקות')
    expect(text).not.toContain('ממתין')
    expect(text).not.toMatch(/callback/i)
    expect(text).not.toContain('סיכוי גבוה')
    expect(text).not.toContain('ליד חם')
  })

  it('answered inbound still appears as recent activity', () => {
    const text = composeRecentInboundAnswer([{ name: 'דנה', at: '2026-08-18T13:17:00.000Z' }], NOW)
    expect(text).toContain('דנה')
    expect(text).toContain('מי ששלח הודעה בוואטסאפ לאחרונה')
    expect(text).not.toContain('ממתין')
  })

  it('empty inbox is honest and invents no names', () => {
    const text = composeRecentInboundAnswer([], NOW)
    expect(text).toContain('אין כרגע הודעות וואטסאפ')
    expect(text).not.toContain('ממתינות')
    expect(text).not.toContain('George')
    expect(text).not.toMatch(/callback/i)
  })

  it('formatInboundAgo stays relative', () => {
    expect(formatInboundAgo('2026-08-18T13:18:00.000Z', NOW)).toBe('לפני דקה')
  })
})
