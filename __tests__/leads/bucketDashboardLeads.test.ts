import { describe, it, expect } from 'vitest'
import { bucketDashboardLeads, type DashboardLead } from '@/lib/leads/bucketDashboardLeads'

// Fixed "now" so tests are deterministic (Date.now() is otherwise non-reproducible).
const NOW = new Date('2026-06-04T12:00:00.000Z').getTime()
const hoursFromNow = (h: number) => new Date(NOW + h * 3_600_000)
const daysFromNow = (d: number) => new Date(NOW + d * 86_400_000)

function lead(over: Partial<DashboardLead>): DashboardLead {
  return {
    id: 1,
    name: 'ליד',
    phone: '0501234567',
    status: 'contacted',
    state: 'updated',
    slaRemainingHours: 40,
    nextAction: null,
    leadSource: null,
    nextFollowUpAt: null,
    ...over,
  }
}

const bucket = (rows: DashboardLead[]) => bucketDashboardLeads(rows, NOW)

describe('Stage 4 ranking — the 5 approved examples', () => {
  it('1. no follow-up → unchanged SLA behavior (lands in "today" via slaRemaining<=24)', () => {
    const r = lead({ id: 1, nextFollowUpAt: null, state: 'updated', slaRemainingHours: 14 })
    const { overdue, today } = bucket([r])
    expect(today.map((x) => x.id)).toEqual([1])
    expect(overdue).toHaveLength(0)
  })

  it('2. future follow-up suppresses SLA-cold → NOT in needs-handling, NOT in today', () => {
    const r = lead({ id: 2, state: 'cold', slaRemainingHours: 0, nextFollowUpAt: daysFromNow(5) })
    const { overdue, today, fresh } = bucket([r])
    expect(overdue).toHaveLength(0)
    expect(today).toHaveLength(0)
    expect(fresh).toHaveLength(0)
  })

  it('3. overdue follow-up on a non-SLA-cold lead → needs-handling (was "today" before)', () => {
    const r = lead({ id: 3, state: 'updated', slaRemainingHours: 22, nextFollowUpAt: daysFromNow(-1) })
    const { overdue, today } = bucket([r])
    expect(overdue.map((x) => x.id)).toEqual([3])
    expect(today).toHaveLength(0)
  })

  it('4. SLA violation, no follow-up → needs-handling, unchanged', () => {
    const r = lead({ id: 4, status: 'new', state: 'cold', slaRemainingHours: 0, nextFollowUpAt: null })
    const { overdue } = bucket([r])
    expect(overdue.map((x) => x.id)).toEqual([4])
  })

  it('5. SLA violation + future follow-up → explicit wins, suppressed from needs-handling', () => {
    const r = lead({ id: 5, status: 'new', state: 'cold', slaRemainingHours: 0, nextFollowUpAt: daysFromNow(3) })
    const { overdue, today, fresh } = bucket([r])
    expect(overdue).toHaveLength(0)
    expect(today).toHaveLength(0)
    expect(fresh).toHaveLength(0)
  })
})

describe('Stage 4 ranking — ordering & edges', () => {
  it('overdue follow-ups rank ABOVE SLA-cold leads, most-overdue first', () => {
    const slaCold = lead({ id: 10, state: 'cold', slaRemainingHours: 0, nextFollowUpAt: null })
    const dueRecent = lead({ id: 11, nextFollowUpAt: hoursFromNow(-1) })
    const dueOld = lead({ id: 12, nextFollowUpAt: daysFromNow(-3) })
    const { overdue } = bucket([slaCold, dueRecent, dueOld])
    // due follow-ups first (oldest→newest), then SLA-cold
    expect(overdue.map((x) => x.id)).toEqual([12, 11, 10])
  })

  it('closed / lost are always excluded, even with a due follow-up', () => {
    const closed = lead({ id: 20, status: 'closed', state: 'cold', nextFollowUpAt: daysFromNow(-1) })
    const lost = lead({ id: 21, status: 'lost', nextFollowUpAt: daysFromNow(-1) })
    const { overdue, today, fresh } = bucket([closed, lost])
    expect([...overdue, ...today, ...fresh]).toHaveLength(0)
  })

  it('a follow-up due exactly now counts as due', () => {
    const r = lead({ id: 30, nextFollowUpAt: new Date(NOW) })
    expect(bucket([r]).overdue.map((x) => x.id)).toEqual([30])
  })

  it('bad/unparseable follow-up date falls back to SLA behavior', () => {
    const r = lead({ id: 31, state: 'cold', slaRemainingHours: 0, nextFollowUpAt: 'not-a-date' })
    expect(bucket([r]).overdue.map((x) => x.id)).toEqual([31])
  })

  it('each bucket caps at 5', () => {
    const rows = Array.from({ length: 8 }, (_, i) => lead({ id: i, status: 'new', state: 'cold', slaRemainingHours: 0, nextFollowUpAt: null }))
    expect(bucket(rows).overdue).toHaveLength(5)
  })

  it('string ISO follow-up dates are handled like Date objects', () => {
    const r = lead({ id: 40, nextFollowUpAt: daysFromNow(-1).toISOString() })
    expect(bucket([r]).overdue.map((x) => x.id)).toEqual([40])
  })

  it('realistic mixed batch — all three buckets resolve together, due follow-ups lead', () => {
    const rows: DashboardLead[] = [
      lead({ id: 1, status: 'new', state: 'cold', slaRemainingHours: 0, nextFollowUpAt: null }), // SLA-cold → overdue
      lead({ id: 2, state: 'updated', slaRemainingHours: 10, nextFollowUpAt: null }), // → today
      lead({ id: 3, status: 'new', state: 'updated', slaRemainingHours: 40, nextFollowUpAt: null }), // → fresh
      lead({ id: 4, nextFollowUpAt: daysFromNow(-2) }), // due follow-up → overdue, top
      lead({ id: 5, state: 'cold', slaRemainingHours: 0, nextFollowUpAt: daysFromNow(4) }), // future fu → suppressed
      lead({ id: 6, status: 'closed', state: 'cold', nextFollowUpAt: daysFromNow(-1) }), // closed → excluded
    ]
    const { overdue, today, fresh } = bucket(rows)
    expect(overdue.map((r) => r.id)).toEqual([4, 1]) // due follow-up ranks above SLA-cold
    expect(today.map((r) => r.id)).toEqual([2])
    expect(fresh.map((r) => r.id)).toEqual([3])
  })
})
