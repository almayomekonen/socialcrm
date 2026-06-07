import { describe, it, expect } from 'vitest'
import { resolveOutcome, isLeadOutcome } from '@/lib/leads/outcomeRules'

const ALL_STATUSES = ['new', 'contacted', 'interested', 'closed', 'lost', null] as const

describe('isLeadOutcome', () => {
  it('accepts the 4 codes, rejects others', () => {
    expect(isLeadOutcome('call_reached')).toBe(true)
    expect(isLeadOutcome('call_won')).toBe(false)
    expect(isLeadOutcome('meeting_completed')).toBe(false)
    expect(isLeadOutcome(null)).toBe(false)
  })
})

describe('resolveOutcome — no_answer', () => {
  it.each(ALL_STATUSES)('status %s → no change, retry tomorrow', (s) => {
    const r = resolveOutcome('call_no_answer', s)
    expect(r.code).toBe('call_no_answer')
    expect(r.nextStatus).toBeNull()
    expect(r.followUp).toEqual({ kind: 'in_days', days: 1 })
  })
})

describe('resolveOutcome — reached (progression, no downgrade)', () => {
  it('new → contacted', () => expect(resolveOutcome('call_reached', 'new').nextStatus).toBe('contacted'))
  it.each(['contacted', 'interested', 'closed', 'lost'])('%s → no status change', (s) =>
    expect(resolveOutcome('call_reached', s).nextStatus).toBeNull(),
  )
  it('always schedules +3 days', () => expect(resolveOutcome('call_reached', 'new').followUp).toEqual({ kind: 'in_days', days: 3 }))
})

describe('resolveOutcome — interested', () => {
  it.each(['new', 'contacted', 'lost'])('%s → interested (lost can reopen)', (s) =>
    expect(resolveOutcome('call_interested', s).nextStatus).toBe('interested'),
  )
  it.each(['interested', 'closed'])('%s → no change (no needless reset / no won regression)', (s) =>
    expect(resolveOutcome('call_interested', s).nextStatus).toBeNull(),
  )
  it('schedules +3 days', () => expect(resolveOutcome('call_interested', 'new').followUp).toEqual({ kind: 'in_days', days: 3 }))
})

describe('resolveOutcome — not_interested (terminal)', () => {
  it.each(['new', 'contacted', 'interested'])('%s → lost', (s) =>
    expect(resolveOutcome('call_not_interested', s).nextStatus).toBe('lost'),
  )
  it.each(['lost', 'closed'])('%s → no change', (s) => expect(resolveOutcome('call_not_interested', s).nextStatus).toBeNull())
  it('clears the follow-up', () => expect(resolveOutcome('call_not_interested', 'interested').followUp).toEqual({ kind: 'clear' }))
})
