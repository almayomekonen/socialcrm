import { describe, it, expect } from 'vitest'
import { isDueWorklistMember, SLA_HOURS, type DueWorklistInput } from '@/lib/leads/dueWorklist'
import { bucketDashboardLeads, type DashboardLead } from '@/lib/leads/bucketDashboardLeads'

const NOW = new Date('2026-06-04T12:00:00.000Z').getTime()
const H = 3_600_000
const D = 86_400_000

// ── Direct rule tests ──────────────────────────────────────────────
describe('isDueWorklistMember — rules', () => {
  const at = (status: string | null, fuOffset: number | null, scOffsetH: number): DueWorklistInput => ({
    status,
    nextFollowUpAt: fuOffset === null ? null : new Date(NOW + fuOffset),
    statusChangedAt: new Date(NOW + scOffsetH * H),
  })

  it('closed / lost are never members (even with a due follow-up)', () => {
    expect(isDueWorklistMember(at('closed', -1 * H, -100), NOW)).toBe(false)
    expect(isDueWorklistMember(at('lost', -1 * H, -100), NOW)).toBe(false)
  })
  it('explicit DUE follow-up → member (overrides SLA, even if not cold)', () => {
    expect(isDueWorklistMember(at('contacted', -1 * H, -1), NOW)).toBe(true)
  })
  it('FUTURE follow-up → NOT a member (suppresses SLA, even if cold)', () => {
    expect(isDueWorklistMember(at('contacted', 5 * D, -100), NOW)).toBe(false)
  })
  it('no follow-up, SLA-cold → member', () => {
    expect(isDueWorklistMember(at('new', null, -3), NOW)).toBe(true) // new SLA 2h, 3h elapsed
    expect(isDueWorklistMember(at('contacted', null, -30), NOW)).toBe(true) // 24h, 30h
    expect(isDueWorklistMember(at('interested', null, -100), NOW)).toBe(true) // 72h, 100h
  })
  it('no follow-up, NOT yet cold → not a member', () => {
    expect(isDueWorklistMember(at('new', null, -1), NOW)).toBe(false) // 1h < 2h
    expect(isDueWorklistMember(at('contacted', null, -10), NOW)).toBe(false) // 10h < 24h
  })
  it('null status with no follow-up → not a member (no SLA)', () => {
    expect(isDueWorklistMember(at(null, null, -1000), NOW)).toBe(false)
  })
  it('null status WITH a due follow-up → member (null is not closed/lost)', () => {
    expect(isDueWorklistMember(at(null, -1 * H, 0), NOW)).toBe(true)
  })
  it('follow-up due exactly now → member', () => {
    expect(isDueWorklistMember(at('contacted', 0, 0), NOW)).toBe(true)
  })
  it('SLA thresholds are the Follow-Up Engine values', () => {
    expect(SLA_HOURS).toEqual({ new: 2, contacted: 24, interested: 72 })
  })
})

// ── Equivalence proof: isDueWorklistMember ≡ bucketDashboardLeads.overdue ──
// Mirror getLeadsTable's CTE so the bucketer sees the same derived fields the DB would produce.
function deriveSla(status: string | null, scAtMs: number, nowMs: number): { state: 'cold' | 'updated' | null; slaRemainingHours: number | null } {
  if (status !== 'new' && status !== 'contacted' && status !== 'interested') return { state: null, slaRemainingHours: null }
  const sla = SLA_HOURS[status]
  const elapsed = (nowMs - scAtMs) / H
  const cold = elapsed >= sla
  return { state: cold ? 'cold' : 'updated', slaRemainingHours: cold ? 0 : sla - elapsed }
}

type Fixture = { id: number; status: string | null; scOffsetH: number; fuOffset: number | null }

function toBucketLead(f: Fixture): DashboardLead {
  const scAtMs = NOW + f.scOffsetH * H
  const { state, slaRemainingHours } = deriveSla(f.status, scAtMs, NOW)
  return {
    id: f.id,
    name: `lead-${f.id}`,
    phone: '0500000000',
    status: f.status as string,
    state,
    slaRemainingHours,
    nextAction: null,
    leadSource: null,
    nextFollowUpAt: f.fuOffset === null ? null : new Date(NOW + f.fuOffset),
  }
}
function toRule(f: Fixture): DueWorklistInput {
  return {
    status: f.status,
    nextFollowUpAt: f.fuOffset === null ? null : new Date(NOW + f.fuOffset),
    statusChangedAt: new Date(NOW + f.scOffsetH * H),
  }
}

describe('equivalence — SQL membership rule ≡ bucketDashboardLeads overdue lane', () => {
  // ≤5 members so bucketDashboardLeads' slice(0,5) never drops a member.
  const fixtures: Fixture[] = [
    { id: 1, status: 'contacted', scOffsetH: -1, fuOffset: -1 * H }, // due follow-up → member
    { id: 2, status: 'contacted', scOffsetH: -30, fuOffset: 5 * D }, // SLA-cold BUT future follow-up → suppressed (NOT member) ★
    { id: 3, status: 'contacted', scOffsetH: -30, fuOffset: null }, // SLA-cold, no fu → member
    { id: 4, status: 'contacted', scOffsetH: -2, fuOffset: null }, // not cold, no fu → today (NOT member)
    { id: 5, status: 'new', scOffsetH: -5, fuOffset: null }, // new cold → member
    { id: 6, status: 'new', scOffsetH: -1, fuOffset: null }, // new fresh → NOT member
    { id: 7, status: 'closed', scOffsetH: -100, fuOffset: -1 * H }, // closed → NOT member
    { id: 8, status: 'lost', scOffsetH: -100, fuOffset: null }, // lost → NOT member
    { id: 9, status: null, scOffsetH: 0, fuOffset: -1 * H }, // null status + due fu → member ★
    { id: 10, status: null, scOffsetH: -1000, fuOffset: null }, // null status, no fu → NOT member
  ]

  it('both classifications agree on every fixture', () => {
    const bucketOverdue = new Set(bucketDashboardLeads(fixtures.map(toBucketLead), NOW).overdue.map((r) => r.id))
    const ruleMembers = new Set(fixtures.filter((f) => isDueWorklistMember(toRule(f), NOW)).map((f) => f.id))

    expect([...ruleMembers].sort()).toEqual([1, 3, 5, 9]) // sanity: the expected members
    expect(bucketOverdue.size).toBeLessThanOrEqual(5) // slice did not interfere
    expect([...bucketOverdue].sort((a, b) => a - b)).toEqual([...ruleMembers].sort((a, b) => a - b))
  })
})
