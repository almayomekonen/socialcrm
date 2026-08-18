import { describe, it, expect } from 'vitest'
import { composeWaitingInboundAnswer } from '@/lib/copilot/general/waitingInboundCopy'

const NOW = Date.parse('2026-08-18T13:19:00.000Z')

describe('composeWaitingInboundAnswer', () => {
  it('frames waiting people, not a recency dump', () => {
    const text = composeWaitingInboundAnswer([{ name: 'George', at: '2026-08-18T13:17:00.000Z' }], NOW)
    expect(text).toContain('מי שממתין למענה בוואטסאפ')
    expect(text).toContain('George')
    expect(text).not.toContain('מי ששלח הודעה בוואטסאפ לאחרונה')
    expect(text).not.toMatch(/callback/i)
  })
})
