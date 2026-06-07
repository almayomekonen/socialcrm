import { describe, it, expect } from 'vitest'
import { recommendReason, pickRecommended, type RecommendInput } from '@/lib/leads/recommend'

const NOW = new Date('2026-06-04T12:00:00.000Z').getTime()
const H = 3_600_000
const D = 86_400_000

const lead = (o: Partial<RecommendInput> & { id: number }): RecommendInput => ({
  name: `lead-${o.id}`,
  phone: '050',
  status: null,
  nextFollowUpAt: null,
  ...o,
})

describe('recommendReason', () => {
  it('follow-up before today → מעקב באיחור', () =>
    expect(recommendReason(lead({ id: 1, status: 'contacted', nextFollowUpAt: new Date(NOW - 2 * D) }), NOW)).toBe('מעקב באיחור'))
  it('follow-up earlier today → מעקב להיום', () =>
    expect(recommendReason(lead({ id: 2, status: 'contacted', nextFollowUpAt: new Date(NOW - 1 * H) }), NOW)).toBe('מעקב להיום'))
  it('new lead created today → ליד חדש מהבוקר', () =>
    expect(recommendReason(lead({ id: 3, status: 'new', createdAt: new Date(NOW - 2 * H) }), NOW)).toBe('ליד חדש מהבוקר'))
  it('new lead created earlier → ליד חדש', () =>
    expect(recommendReason(lead({ id: 4, status: 'new', createdAt: new Date(NOW - 3 * D) }), NOW)).toBe('ליד חדש'))
  it('cold lead, last call unanswered → לא נענה בפעם האחרונה', () =>
    expect(recommendReason(lead({ id: 5, status: 'contacted', lastOutcomeType: 'call_no_answer' }), NOW)).toBe('לא נענה בפעם האחרונה'))
  it('cold lead, no outcome → ממתין לטיפול', () =>
    expect(recommendReason(lead({ id: 6, status: 'contacted' }), NOW)).toBe('ממתין לטיפול'))
})

describe('pickRecommended — transparent priority', () => {
  const dueFollowUp = lead({ id: 10, status: 'contacted', nextFollowUpAt: new Date(NOW - 1 * D) })
  const coldDue = lead({ id: 11, status: 'contacted' })
  const newLead = lead({ id: 12, status: 'new', createdAt: new Date(NOW - 1 * H) })

  it('a due follow-up beats new leads and cold', () => {
    const r = pickRecommended([dueFollowUp, coldDue], [newLead], NOW)
    expect(r?.lead.id).toBe(10)
    expect(r?.reason).toBe('מעקב באיחור')
  })
  it('no due follow-up → freshest new lead', () => {
    const r = pickRecommended([coldDue], [newLead], NOW)
    expect(r?.lead.id).toBe(12)
    expect(r?.reason).toBe('ליד חדש מהבוקר')
  })
  it('no due follow-up, no new → the cold worklist top', () => {
    const r = pickRecommended([coldDue], [], NOW)
    expect(r?.lead.id).toBe(11)
    expect(r?.reason).toBe('ממתין לטיפול')
  })
  it('nothing actionable → null', () => {
    expect(pickRecommended([], [], NOW)).toBeNull()
  })
})
