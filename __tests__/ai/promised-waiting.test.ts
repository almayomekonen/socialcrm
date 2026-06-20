import { describe, it, expect } from 'vitest'
import { promisedButWaitingQuery } from '@/db/briefing'
import { promisedWaitingSentence } from '@/lib/copilot/general/promisedWaiting'
import { Roles } from '@/types/roles'

// SQL-level assertions (no live DB) — same approach as briefing-scope.test.ts.
function sqlFor(plan: string, role: Roles, gotPermIds: number[]) {
  return promisedButWaitingQuery(123, plan, { user: { role }, gotPermIds }).toSQL()
}

describe('promisedButWaitingQuery — the three-fact join + 14-day recency guard', () => {
  it('encodes all four conditions (a) overdue (b) inbound-after (c) no-reply-since (d) recent', () => {
    const { sql, bindings } = sqlFor('pro', Roles.ADMIN, [])
    const s = sql.toLowerCase()
    expect(s).toContain('"nextfollowupat" <') // (a)
    expect(s).toContain('last_inbound_at > clients."nextfollowupat"') // (b)
    expect(s).toMatch(/last_outbound_at is null or .*last_outbound_at < .*last_inbound_at/) // (c)
    expect(s).toContain('make_interval') // (d) recency guard
    expect(bindings).toContain(14) // 14 days, per requirement
  })

  it('aggregates last inbound/outbound per lead, scopes messages to whatsapp, reports true total', () => {
    const { sql, bindings } = sqlFor('pro', Roles.ADMIN, [])
    const s = sql.toLowerCase()
    expect(s).toContain('filter (where m.direction') // conditional MAX aggregates
    expect(s).toContain('count(*) over()') // true total before LIMIT
    expect(bindings).toContain('whatsapp')
  })

  it('routes through scopedLeads — AGENT constrained to gotPermIds, agency + lead scoped', () => {
    const { sql, bindings } = sqlFor('pro', Roles.AGNT, [7, 9])
    const s = sql.toLowerCase()
    expect(s).toMatch(/"userid" in/) // permission gate preserved (catastrophic-risk control)
    expect(s).toContain('"agencyid" =')
    expect(s).toContain('"lead" =')
    expect(bindings).toEqual(expect.arrayContaining([7, 9, 123]))
  })

  it('ADMIN is NOT constrained by gotPermIds', () => {
    expect(sqlFor('pro', Roles.ADMIN, []).sql.toLowerCase()).not.toMatch(/"userid" in/)
  })

  it('free plan hides over-quota leads', () => {
    expect(sqlFor('free', Roles.AGNT, [1]).sql.toLowerCase()).toContain('"overquota"')
  })
})

describe('promisedWaitingSentence — deterministic operator copy', () => {
  it('singular', () => {
    expect(promisedWaitingSentence(1)).toBe('ליד אחד שהבטחת לחזור אליו גם כתב לך בינתיים — והוא עדיין מחכה.')
  })
  it('plural includes the true count', () => {
    expect(promisedWaitingSentence(3)).toBe('3 לידים שהבטחת לחזור אליהם גם כתבו לך בינתיים — והם עדיין מחכים.')
  })
})
