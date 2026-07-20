import { describe, expect, it } from 'vitest'
import { candidateFactsQuery } from '@/db/today/facts'
import { touchedTodayQuery } from '@/db/today/handled'
import { Roles } from '@/types/roles'

// SQL-level construction tests (no live DB — the repo's DB-backed harness is
// blocked pre-existing: base tables are Prisma-created, so knex migrate.latest()
// fails; see briefing-readers.test.ts). Mirrors __tests__/ai/briefing-scope.test.ts:
// assert the GENERATED SQL enforces scope, terminal exclusion, the C-2 human-outbound
// marker, and no pagination — the fact-derivation contract, proven at the SQL level.

const AGENT = { user: { role: Roles.AGNT }, gotPermIds: [7] }
const ADMIN = { user: { role: Roles.ADMIN }, gotPermIds: [] }
const compiled = (scope: typeof AGENT) => candidateFactsQuery(123, 'pro', scope).toString().toLowerCase()

describe('candidateFactsQuery construction', () => {
  it('INV-5: scoped to agency + lead=true + gotPermIds for non-admins', () => {
    const s = compiled(AGENT)
    expect(s).toMatch(/"agencyid" =/)
    expect(s).toMatch(/"lead" =/)
    expect(s).toMatch(/"userid" in/)
    expect(s).toContain('7')
  })

  it('INV-5: admins are NOT constrained by gotPermIds', () => {
    expect(candidateFactsQuery(123, 'pro', ADMIN).toString().toLowerCase()).not.toMatch(/"userid" in/)
  })

  it('INV-3: excludes terminal statuses at source', () => {
    const s = compiled(AGENT)
    expect(s).toMatch(/"status" not in/)
    expect(s).toContain("'closed'")
    expect(s).toContain("'lost'")
  })

  it('INV-11 / C-2: human outbound via metadata.source marker, never sentByUserId', () => {
    const s = compiled(AGENT)
    expect(s).toContain("metadata->>'source') is distinct from 'auto_response'")
    expect(s).toContain("filter (where m.direction = 'inbound')")
    expect(s).not.toContain('sentbyuserid')
  })

  it('INV-2/15: no pagination (no LIMIT/OFFSET)', () => {
    const s = compiled(AGENT)
    expect(s).not.toContain(' limit ')
    expect(s).not.toContain(' offset ')
  })
})

describe('touchedTodayQuery construction', () => {
  it('filters lastActivityAt >= dayStart (bound supplied by the domain layer)', () => {
    const dayStart = Date.UTC(2026, 6, 19, 21, 0, 0)
    const { bindings } = touchedTodayQuery(123, 'pro', AGENT, dayStart).toSQL()
    expect(touchedTodayQuery(123, 'pro', AGENT, dayStart).toString().toLowerCase()).toMatch(/"lastactivityat" >=/)
    expect(bindings.some((b) => b instanceof Date && b.getTime() === dayStart)).toBe(true)
  })
})
