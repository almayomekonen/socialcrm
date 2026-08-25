/**
 * Phase-1 detection facts — SQL-level scope contract (no live DB).
 *
 * `agencyLeadFactsQuery` is the ONLY new read the proactive path performs, and
 * it is the one place a tenant boundary could be lost. It is a builder, so the
 * generated SQL is the contract: assert the agency filter, the terminal
 * exclusion, the plan gate, the absence of any per-user permission filter, and
 * that customer identity is never selected.
 *
 * Mirrors __tests__/today/facts.sql.test.ts, deliberately — this query is that
 * query with the VIEWER removed, and the diff between the two assertions is the
 * whole reason this module exists.
 *
 * Runs under `test:unit` (VITEST_NO_DB=1).
 */
import { describe, expect, it } from 'vitest'
import { agencyLeadFactsQuery } from '@/db/ai/leadFacts'

const compiled = (agencyId = 103, plan = 'pro') => agencyLeadFactsQuery(agencyId, plan).toString().toLowerCase()

describe('agencyLeadFactsQuery — tenant scope', () => {
  it('is filtered to one agency, by that agency id', () => {
    const s = compiled(103)
    expect(s).toMatch(/"clients"\."agencyid" =/)
    expect(s).toContain('103')
  })

  it('a different agency compiles a different bound id — the filter is not a constant', () => {
    const s = compiled(104)
    expect(s).toMatch(/"clients"\."agencyid" = 104/)
    expect(s).not.toContain('= 103')
  })

  it('the inner message aggregation is scoped to the same agency', () => {
    expect(compiled(103)).toMatch(/"m"\."agencyid" =/)
  })

  it('reads leads only', () => {
    expect(compiled()).toMatch(/"clients"\."lead" =/)
  })
})

describe('agencyLeadFactsQuery — no permission fan-out', () => {
  // The load-bearing difference from candidateFactsQuery. A proactive sweep has
  // no session; touching user_perms logic on a cron path is the thing this
  // module exists to avoid.
  it('carries NO per-user permission filter', () => {
    const s = compiled()
    expect(s).not.toMatch(/"userid" in/)
    expect(s).not.toContain('user_perms')
    expect(s).not.toContain('gotpermids')
  })
})

describe('agencyLeadFactsQuery — business rules reused, not re-derived', () => {
  it('excludes terminal statuses at source', () => {
    const s = compiled()
    expect(s).toMatch(/"status" not in/)
    expect(s).toContain("'closed'")
    expect(s).toContain("'lost'")
  })

  it('applies the free-plan over-quota gate, and only on the free plan', () => {
    expect(compiled(103, 'free')).toMatch(/"overquota" =/)
    expect(compiled(103, 'pro')).not.toMatch(/"overquota" =/)
  })

  it('uses the C-2 human-outbound marker, never sentByUserId', () => {
    const s = compiled()
    expect(s).toContain("metadata->>'source') is distinct from 'auto_response'")
    expect(s).toContain("filter (where m.direction = 'inbound')")
    expect(s).not.toContain('sentbyuserid')
  })

  it('selects the classifier’s inputs and no customer identity', () => {
    const s = compiled()
    expect(s).toContain('"nextfollowupat"')
    expect(s).toContain('"lastactivityat"')
    expect(s).not.toMatch(/"clients"\."name"/)
    expect(s).not.toMatch(/"clients"\."phone"/)
  })

  it('is unpaginated — detection sees the whole agency or it is not detection', () => {
    const s = compiled()
    expect(s).not.toContain(' limit ')
    expect(s).not.toContain(' offset ')
  })
})
