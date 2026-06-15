import { describe, it, expect } from 'vitest'
import { scopedLeads } from '@/db/briefing'
import { Roles } from '@/types/roles'

// CATASTROPHIC-RISK CONTROL (no live DB needed). Asserts the generated SQL of
// the single permission gate: non-admins MUST be constrained to `gotPermIds`,
// admins must NOT be, and every query stays scoped to the agency + lead=true.
// A full end-to-end seeded version lives in briefing-readers.integration.test.ts.

function sqlFor(plan: string, scope: { user: { role: Roles }; gotPermIds: number[] }) {
  return scopedLeads(123, plan, scope).select('id').toSQL()
}

describe('scopedLeads — permission gate (SQL level)', () => {
  it('AGENT is constrained to gotPermIds', () => {
    const { sql, bindings } = sqlFor('pro', { user: { role: Roles.AGNT }, gotPermIds: [7, 9] })
    expect(sql.toLowerCase()).toMatch(/"userid" in/)
    expect(bindings).toEqual(expect.arrayContaining([7, 9]))
  })

  it('MNGR is constrained to gotPermIds (team expansion happens upstream in getPerms)', () => {
    const { sql } = sqlFor('pro', { user: { role: Roles.MNGR }, gotPermIds: [1] })
    expect(sql.toLowerCase()).toMatch(/"userid" in/)
  })

  it('ADMIN is NOT constrained by gotPermIds', () => {
    const { sql } = sqlFor('pro', { user: { role: Roles.ADMIN }, gotPermIds: [] })
    expect(sql.toLowerCase()).not.toMatch(/"userid" in/)
  })

  it('always scopes by agency and lead=true', () => {
    const { sql, bindings } = sqlFor('pro', { user: { role: Roles.AGNT }, gotPermIds: [1] })
    expect(sql.toLowerCase()).toMatch(/"agencyid" =/)
    expect(sql.toLowerCase()).toMatch(/"lead" =/)
    expect(bindings).toContain(123)
  })

  it('free plan hides over-quota leads; pro does not', () => {
    const free = sqlFor('free', { user: { role: Roles.AGNT }, gotPermIds: [1] }).sql.toLowerCase()
    const pro = sqlFor('pro', { user: { role: Roles.AGNT }, gotPermIds: [1] }).sql.toLowerCase()
    expect(free).toMatch(/"overquota"/)
    expect(pro).not.toMatch(/"overquota"/)
  })
})
