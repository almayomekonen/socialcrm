/**
 * get_revenue — the tool boundary, with the reader mocked (the reader itself is
 * pinned against Performance in __tests__/deals/agentRevenue.db.test.ts).
 *
 * What is pinned here: the model supplies only a period; scope comes from the
 * closure; paid revenue, paid deals and pipeline are three separately citable
 * metrics; a role with no Performance view and a bad custom range are refused
 * without reading anything; and "no deals recorded" is distinguishable from
 * "₪0 earned".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getRevenueTotals } = vi.hoisted(() => ({ getRevenueTotals: vi.fn() }))
vi.mock('@/db/agentRevenue', async (orig) => ({ ...(await orig<typeof import('@/db/agentRevenue')>()), getRevenueTotals }))

import { makeGetRevenue, REVENUE_METRIC_IDS } from '@/lib/agent/tools/getRevenue'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import { getDateRange } from '@/lib/dates'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const ADMIN: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }
const REP: AgentScope = { ...ADMIN, userId: 4, role: Roles.AGNT, gotPermIds: [4, 9] }
const NOW = new Date(2026, 5, 15, 12).getTime()
const OPTS = { toolCallId: 't1', messages: [] } as never
const TOTALS = { paidRevenue: 2450, paidDeals: 4, pipelineValue: 1000, dealsInPeriod: 8, dealsEver: 20 }

function build(scope: AgentScope = ADMIN) {
  const evidence = createEvidenceCollector()
  const t = makeGetRevenue({
    scope,
    evidence,
    budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
    nowMs: NOW,
  })
  const run = (input: Record<string, unknown>) =>
    (t as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, any>> }).execute(input, OPTS)
  return { run, evidence }
}

beforeEach(() => {
  getRevenueTotals.mockReset()
  getRevenueTotals.mockResolvedValue(TOTALS)
})

describe('get_revenue', () => {
  it("reads with the closure's scope (agency, role, permissions) — never anything the model sent", async () => {
    const { run } = build(REP)
    await run({ period: 'this_month', agencyId: 999, gotPermIds: [] })
    expect(getRevenueTotals).toHaveBeenCalledTimes(1)
    expect(getRevenueTotals.mock.calls[0][0]).toEqual({ user: { role: Roles.AGNT }, gotPermIds: [4, 9], agencyId: 7 })
  })

  it("uses Performance's own window for the period, at the investigation's clock", async () => {
    const { run } = build()
    for (const [period, label] of [
      ['this_month', 'החודש הנוכחי'],
      ['last_month', 'החודש הקודם'],
      ['this_year', 'השנה הנוכחית'],
      ['last_year', 'השנה הקודמת'],
    ] as const) {
      getRevenueTotals.mockClear()
      await run({ period })
      expect(getRevenueTotals.mock.calls[0][1], period).toEqual(getDateRange(label, new Date(NOW)))
    }
  })

  it('a custom range passes the two days exactly as given', async () => {
    const { run } = build()
    const out = await run({ period: 'custom', from: '2026-01-01', to: '2026-03-31' })
    expect(getRevenueTotals.mock.calls[0][1]).toEqual({ start: '2026-01-01', end: '2026-03-31' })
    expect(out).toMatchObject({ from: '2026-01-01', to: '2026-03-31', periodLabel: 'טווח תאריכים' })
  })

  it.each([
    [{ period: 'custom' }],
    [{ period: 'custom', from: '2026-01-01' }],
    [{ period: 'custom', from: '2026-02-30', to: '2026-03-01' }],
    [{ period: 'custom', from: '2026-03-01', to: '2026-01-01' }],
    [{ period: 'custom', from: '1/1/2026', to: '2026-01-31' }],
  ])('an invalid custom range is refused without reading: %j', async (input) => {
    const { run, evidence } = build()
    expect(await run(input)).toMatchObject({ invalidRange: true })
    expect(getRevenueTotals).not.toHaveBeenCalled()
    expect(evidence.hasMetric('revenue.paid')).toBe(false)
  })

  it('returns paid revenue, paid deals and pipeline as three separate metrics, each citable on its own', async () => {
    const { run, evidence } = build()
    const out = await run({ period: 'this_month' })
    expect(out.metrics).toEqual({
      'revenue.paid': 2450,
      'revenue.paid_deals': 4,
      'revenue.pipeline': 1000,
      'revenue.deals_in_period': 8,
    })
    for (const m of REVENUE_METRIC_IDS) expect(evidence.hasMetric(m), m).toBe(true)
    expect(out).toMatchObject({ currency: 'ILS', recordsDeals: true, scope: 'whole agency' })
    expect(out.dateBasis).toMatch(/offer date/)
  })

  it("a rep's result says it covers only the deals they may see", async () => {
    const { run } = build(REP)
    expect((await run({ period: 'this_year' })).scope).toBe('the deals this user may see on Performance')
  })

  it('an account that never recorded a deal is reported as such, not as ₪0 earned', async () => {
    getRevenueTotals.mockResolvedValue({ paidRevenue: 0, paidDeals: 0, pipelineValue: 0, dealsInPeriod: 0, dealsEver: 0 })
    const { run } = build()
    expect(await run({ period: 'this_year' })).toMatchObject({ recordsDeals: false })
  })

  it.each([[[]], [[0]]])('a non-admin with no reps in scope (%j) is refused, never shown as "no deals recorded"', async (ids) => {
    const { run, evidence } = build({ ...REP, role: Roles.OFFICE, gotPermIds: ids })
    expect(await run({ period: 'this_year' })).toMatchObject({ restricted: true })
    expect(getRevenueTotals).not.toHaveBeenCalled()
    expect(evidence.hasMetric('revenue.paid')).toBe(false)
  })

  it('an admin\'s empty gotPermIds means the whole agency, not "no access"', async () => {
    const { run } = build(ADMIN)
    expect(await run({ period: 'this_year' })).toMatchObject({ scope: 'whole agency', recordsDeals: true })
    expect(getRevenueTotals).toHaveBeenCalledTimes(1)
  })

  it("a named period returns its label, not Performance's internal bounds; a custom range returns its own dates", async () => {
    const { run } = build()
    for (const period of ['this_month', 'last_month', 'this_year', 'last_year']) {
      const out = await run({ period })
      expect(out, period).not.toHaveProperty('from')
      expect(out, period).not.toHaveProperty('to')
      expect(out.periodLabel, period).toBeTruthy()
    }
  })

  it('a role with no Performance view is refused, with no read and no evidence', async () => {
    const { run, evidence } = build({ ...REP, role: 'EXT' as AgentScope['role'] })
    expect(await run({ period: 'this_month' })).toMatchObject({ restricted: true })
    expect(getRevenueTotals).not.toHaveBeenCalled()
    expect(evidence.hasMetric('revenue.paid')).toBe(false)
  })
})

describe('the prompt keeps paid revenue, pipeline and forecasts apart', async () => {
  const { AGENT_SYSTEM_PROMPT } = await import('@/lib/agent/prompt')
  it('routes revenue questions to get_revenue', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/get_revenue — כשהשאלה על הכנסות/)
  })
  it('pipeline is neither revenue nor a forecast, and the two are never summed', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/revenue\.pipeline הוא שווי העסקאות הפתוחות — לא הכנסה ולא תחזית/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תחבר ביניהם/)
  })
  it("states the offer-date basis, the no-deals case, the restricted case and a rep's partial view", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/לפי תאריך הפנייה/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/recordsDeals=false/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/restricted — אמור שאין לך גישה/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/בעסקאות שלך/)
  })
})
