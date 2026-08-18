import { describe, it, expect } from 'vitest'
import { composeGrowthCopy } from '@/lib/copilot/general/growthCopy'

describe('composeGrowthCopy — growth from CRM facts, never invented money', () => {
  it('grounds the 46 stale + 1 waiting case without financial numbers', () => {
    const text = composeGrowthCopy({
      overdueTasks: 0,
      dueToday: 0,
      staleLeads: 46,
      waitingConversations: 1,
      newLeads: 0,
      meetingsToday: 0,
    })
    expect(text).toContain('אין לי נתוני הכנסה')
    expect(text).toContain('46 לידים')
    expect(text).toContain('1 שיחה שממתינה')
    expect(text).toContain('הייתי מתחיל בטיפול בלידים שלא קיבלו קשר')
    expect(text).not.toMatch(/\d[\d,]+\s*₪/)
    expect(text).not.toMatch(/%/)
  })

  it('all-clear still admits the revenue gap', () => {
    const text = composeGrowthCopy({
      overdueTasks: 0,
      dueToday: 0,
      staleLeads: 0,
      waitingConversations: 0,
      newLeads: 0,
      meetingsToday: 0,
    })
    expect(text).toContain('אין לי נתוני הכנסה')
    expect(text).not.toMatch(/₪/)
  })
})
