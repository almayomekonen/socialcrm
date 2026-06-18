import { describe, it, expect } from 'vitest'
import { deleteLeadsMessage, blockReasonText } from '@/lib/leads/deleteResult'
import type { BlockedLead } from '@/lib/leads/deleteResult'

const blocked = (id: number, reason: BlockedLead['reason']): BlockedLead => ({ id, name: null, reason })

describe('deleteLeadsMessage — success / partial / all-blocked toasts', () => {
  it('all deleted → success', () => {
    expect(deleteLeadsMessage({ deletedCount: 12, blockedCount: 0, blockedLeads: [] })).toEqual({
      icon: 'success',
      msg: 'נמחקו 12 לידים בהצלחה',
    })
  })

  it('single deleted → singular success', () => {
    expect(deleteLeadsMessage({ deletedCount: 1, blockedCount: 0, blockedLeads: [] }).msg).toBe('נמחק ליד אחד בהצלחה')
  })

  it('partial: one blocked uses its specific reason', () => {
    const r = deleteLeadsMessage({ deletedCount: 12, blockedCount: 1, blockedLeads: [blocked(1, 'invoices')] })
    expect(r.icon).toBe('success')
    expect(r.msg).toBe('נמחקו 12 לידים. ליד אחד לא נמחק כי קיימות חשבוניות עבור הליד')
  })

  it('partial: multiple blocked uses the generic line', () => {
    const r = deleteLeadsMessage({
      deletedCount: 8,
      blockedCount: 5,
      blockedLeads: [blocked(1, 'invoices'), blocked(2, 'billing_profile')],
    })
    expect(r.msg).toBe('נמחקו 8 לידים. 5 לידים לא נמחקו כי קיימות עבורם רשומות חיוב')
  })

  it('all blocked (nothing deleted) → ban icon, blocked clause only', () => {
    const r = deleteLeadsMessage({ deletedCount: 0, blockedCount: 1, blockedLeads: [blocked(1, 'billing_profile')] })
    expect(r).toEqual({ icon: 'ban', msg: 'ליד אחד לא נמחק כי קיים פרופיל חיוב פעיל' })
  })

  it('nothing in scope → ban', () => {
    expect(deleteLeadsMessage({ deletedCount: 0, blockedCount: 0, blockedLeads: [] })).toEqual({
      icon: 'ban',
      msg: 'לא נמחקו לידים',
    })
  })
})

describe('blockReasonText — per-dependency Hebrew', () => {
  it('maps each billing dependency', () => {
    expect(blockReasonText('billing_profile')).toBe('קיים פרופיל חיוב פעיל')
    expect(blockReasonText('invoices')).toBe('קיימות חשבוניות עבור הליד')
    expect(blockReasonText('financial_events')).toBe('קיימות תנועות כספיות עבור הליד')
  })
})
