/**
 * What the ad report asks Meta for, and what it does when parts of the answer
 * fail. Graph is faked at the fetch boundary (fixtures, not a live account).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.META_APP_SECRET = 'app-secret'
})

import { getAdsReport } from '@/lib/facebook/ads/report'
import { getAdsBreakdown } from '@/lib/facebook/ads/breakdown'

type Call = { url: URL; init: RequestInit }
let calls: Call[] = []
type Handler = (url: URL) => { status?: number; body: unknown }

function mockGraph(handler: Handler) {
  calls = []
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url))
    calls.push({ url: u, init: init ?? {} })
    const { status = 200, body } = handler(u)
    return { ok: status < 400, status, json: async () => body }
  }) as unknown as typeof fetch
}

const act = (type: string, value: number) => ({ action_type: type, value: String(value) })
const q = (c: Call, k: string) => c.url.searchParams.get(k)
const isStatusLookup = (u: URL) => u.searchParams.has('ids')

const TOTALS = {
  date_start: '2026-08-16', date_stop: '2026-09-14',
  spend: '1000', impressions: '50000', reach: '20000', frequency: '2.5', clicks: '900', ctr: '1.8', cpc: '1.11', cpm: '20',
  inline_link_clicks: '600', inline_link_click_ctr: '1.2', cost_per_inline_link_click: '1.67',
  actions: [act('lead', 25), act('onsite_conversion.lead_grouped', 25)], attribution_setting: '7d_click,1d_view',
}
const CAMPAIGNS = [
  { campaign_id: '111', campaign_name: 'Leads Sept', objective: 'OUTCOME_LEADS', spend: '700', impressions: '30000', reach: '15000', inline_link_clicks: '300', actions: [act('lead', 25)] },
  { campaign_id: '222', campaign_name: 'Brand', objective: 'OUTCOME_AWARENESS', spend: '300', impressions: '20000', reach: '12000' },
]

function happy(overrides: Partial<Record<'previous' | 'daily' | 'status' | 'campaign', { status: number; body: unknown }>> = {}): Handler {
  return (u) => {
    if (isStatusLookup(u)) return overrides.status ?? { body: { 111: { effective_status: 'ACTIVE' }, 222: { effective_status: 'PAUSED' } } }
    const level = u.searchParams.get('level')
    if (level === 'campaign') return overrides.campaign ?? { body: { data: CAMPAIGNS } }
    if (u.searchParams.get('time_increment') === '1') return overrides.daily ?? { body: { data: [{ date_start: '2026-08-16', spend: '30', impressions: '1500', inline_link_clicks: '20' }] } }
    if (u.searchParams.has('time_range') && !(u.searchParams.get('fields') ?? '').includes('date_stop')) return overrides.previous ?? { body: { data: [{ spend: '800', impressions: '40000', reach: '18000', actions: [act('lead', 20)] }] } }
    return { body: { data: [TOTALS] } }
  }
}

const RANGE = { kind: 'preset', preset: 'last_30d' } as const

beforeEach(() => {
  calls = []
})

describe('getAdsReport — what Meta is asked', () => {
  it('asks for reach, frequency, link clicks and actions; the campaign level adds the objective; no deprecated attribution parameter', async () => {
    mockGraph(happy())
    const res = await getAdsReport('TOKEN', 'act_9', RANGE)
    expect('value' in res).toBe(true)
    const account = calls.find((c) => q(c, 'level') === 'account' && q(c, 'date_preset'))!
    for (const f of ['spend', 'reach', 'frequency', 'inline_link_clicks', 'inline_link_click_ctr', 'cost_per_inline_link_click', 'actions', 'action_values', 'attribution_setting', 'date_start', 'date_stop']) {
      expect(q(account, 'fields')!.split(',')).toContain(f)
    }
    const campaign = calls.find((c) => q(c, 'level') === 'campaign')!
    expect(q(campaign, 'fields')!.split(',')).toEqual(expect.arrayContaining(['campaign_id', 'campaign_name', 'objective']))
    for (const c of calls) {
      expect(c.url.searchParams.has('use_unified_attribution_setting')).toBe(false)
      expect(c.url.toString()).not.toContain('TOKEN')
      expect(c.init.method).toBe('GET')
    }
  })

  it('compares with the equally long period right before Meta’s own date_start/date_stop', async () => {
    mockGraph(happy())
    const res = await getAdsReport('T', 'act_9', RANGE)
    const prev = calls.find((c) => q(c, 'time_range'))!
    expect(JSON.parse(q(prev, 'time_range')!)).toEqual({ since: '2026-07-17', until: '2026-08-15' })
    if (!('value' in res)) throw new Error('expected report')
    expect(res.value.period).toEqual({ since: '2026-08-16', until: '2026-09-14' })
    expect(res.value.previous).toMatchObject({ period: { since: '2026-07-17', until: '2026-08-15' }, totals: { spend: 800, leads: 20 } })
  })

  it('builds campaign rows with objective results and delivery status, highest spend first', async () => {
    mockGraph(happy())
    const res = await getAdsReport('T', 'act_9', RANGE)
    if (!('value' in res)) throw new Error('expected report')
    expect(res.value.campaigns.map((c) => [c.name, c.status, c.result.kind, c.result.count])).toEqual([
      ['Leads Sept', 'ACTIVE', 'leads', 25],
      ['Brand', 'PAUSED', 'reach', 12000],
    ])
    expect(res.value.campaigns[0].result.cost).toBe(28)
    expect(res.value.totals).toMatchObject({ leads: 25, reach: 20000, frequency: 2.5 })
    expect(res.value.daily).toHaveLength(30)
  })

  it('daily trend only for ranges up to 92 days — a longer range asks Meta for nothing daily', async () => {
    // The totals call is the one asking for date_start/date_stop (a custom range also uses time_range).
    mockGraph((u) => (u.searchParams.get('level') === 'account' && (u.searchParams.get('fields') ?? '').includes('date_stop')
      ? { body: { data: [{ ...TOTALS, date_start: '2026-01-01', date_stop: '2026-06-30' }] } }
      : happy()(u)))
    const res = await getAdsReport('T', 'act_9', { kind: 'custom', since: '2026-01-01', until: '2026-06-30' })
    if (!('value' in res)) throw new Error('expected report')
    expect(res.value.daily).toBe('too_long')
    expect(calls.some((c) => q(c, 'time_increment'))).toBe(false)
  })
})

describe('getAdsReport — honest comparison and graceful fields', () => {
  it('a period that includes today (account timezone) is not compared with a full previous period', async () => {
    mockGraph((u) => ((u.searchParams.get('fields') ?? '').includes('date_stop') && u.searchParams.get('level') === 'account'
      ? { body: { data: [{ ...TOTALS, date_start: '2026-09-01', date_stop: '2026-09-15' }] } }
      : happy()(u)))
    const res = await getAdsReport('T', 'act_9', { kind: 'preset', preset: 'this_month' }, { today: '2026-09-15' })
    if (!('value' in res)) throw new Error('expected report')
    expect(res.value.previous).toBe('partial')
    expect(calls.some((c) => q(c, 'time_range'))).toBe(false)
  })

  it('if Meta refuses the wider field set, the report still loads on the basic fields', async () => {
    mockGraph((u) => {
      const fields = u.searchParams.get('fields') ?? ''
      if (fields.includes('inline_link_clicks') || fields.includes('objective')) return { status: 400, body: { error: { code: 100, message: 'invalid field' } } }
      return happy()(u)
    })
    const res = await getAdsReport('T', 'act_9', RANGE)
    if (!('value' in res)) throw new Error('expected report')
    expect(res.value.reducedFields).toBe(true)
    expect(res.value.totals).toMatchObject({ spend: 1000, clicks: 900 })
    expect(calls.some((c) => q(c, 'time_increment'))).toBe(false)
    const campaign = calls.find((c) => q(c, 'level') === 'campaign')!
    expect(q(campaign, 'fields')).toBe('campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc')
  })

  it('no daily rows while the account spent is a failed trend, not a month of zeros', async () => {
    mockGraph(happy({ daily: { status: 200, body: { data: [] } } }))
    const res = await getAdsReport('T', 'act_9', RANGE)
    if (!('value' in res)) throw new Error('expected report')
    expect(res.value.daily).toBe('unavailable')
  })
})

describe('getAdsReport — partial failures are flagged, never shown as zero', () => {
  it.each([
    ['previous', (v: { previous: unknown }) => expect(v.previous).toBe('unavailable')],
    ['daily', (v: { daily: unknown }) => expect(v.daily).toBe('unavailable')],
    ['status', (v: { statusesAvailable: boolean; campaigns: { status: string | null }[] }) => {
      expect(v.statusesAvailable).toBe(false)
      expect(v.campaigns.every((c) => c.status === null)).toBe(true)
    }],
  ] as const)('%s fails → the report still loads with that part unavailable', async (part, check) => {
    mockGraph(happy({ [part]: { status: 500, body: { error: { code: 2 } } } }))
    const res = await getAdsReport('T', 'act_9', RANGE)
    if (!('value' in res)) throw new Error('expected report')
    check(res.value as never)
    expect(res.value.totals?.spend).toBe(1000)
  })

  it('campaigns failing fails the report — its main content cannot be half-shown', async () => {
    mockGraph(happy({ campaign: { status: 400, body: { error: { code: 17 } } } }))
    expect(await getAdsReport('T', 'act_9', RANGE)).toEqual({ ok: false, reason: 'rate_limited' })
  })

  it('status lookups batch ids 50 at a time, only ids Meta returned', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ campaign_id: String(1000 + i), campaign_name: `c${i}`, objective: 'OUTCOME_TRAFFIC', spend: '1', impressions: '10' }))
    mockGraph((u) => (u.searchParams.get('level') === 'campaign' ? { body: { data: many } } : isStatusLookup(u) ? { body: {} } : happy()(u)))
    await getAdsReport('T', 'act_9', RANGE)
    const lookups = calls.filter((c) => isStatusLookup(c.url))
    expect(lookups.map((c) => q(c, 'ids')!.split(',').length)).toEqual([50, 50, 20])
  })
})

describe('getAdsBreakdown — drill-down stays inside the verified account', () => {
  it('ad sets of a campaign: filtered on campaign.id through the account’s own insights edge', async () => {
    mockGraph((u) => (isStatusLookup(u)
      ? { body: { 501: { effective_status: 'ACTIVE' } } }
      : { body: { data: [
          { adset_id: '501', adset_name: 'Tel Aviv 25-45', campaign_id: '111', campaign_name: 'Leads Sept', objective: 'OUTCOME_LEADS', spend: '400', impressions: '9000', actions: [act('lead', 16)] },
          { adset_id: '999', adset_name: 'other campaign', campaign_id: '777', objective: 'OUTCOME_LEADS', spend: '1' },
        ] } }))
    const res = await getAdsBreakdown('T', 'act_9', RANGE, { campaignId: '111' })
    const insights = calls.find((c) => !isStatusLookup(c.url))!
    expect(insights.url.pathname).toMatch(/\/act_9\/insights$/)
    expect(q(insights, 'level')).toBe('adset')
    expect(JSON.parse(q(insights, 'filtering')!)).toEqual([{ field: 'campaign.id', operator: 'EQUAL', value: '111' }])
    if (!('value' in res)) throw new Error('expected breakdown')
    expect(res.value.campaign).toEqual({ id: '111', name: 'Leads Sept' })
    expect(res.value.rows.map((r) => [r.id, r.status, r.result.count, r.result.cost])).toEqual([['501', 'ACTIVE', 16, 25]])
  })

  it('ads of an ad set add the adset.id filter', async () => {
    mockGraph(() => ({ body: { data: [] } }))
    await getAdsBreakdown('T', 'act_9', RANGE, { campaignId: '111', adsetId: '501' })
    const insights = calls.find((c) => !isStatusLookup(c.url))!
    expect(q(insights, 'level')).toBe('ad')
    expect(JSON.parse(q(insights, 'filtering')!)).toEqual([
      { field: 'campaign.id', operator: 'EQUAL', value: '111' },
      { field: 'adset.id', operator: 'EQUAL', value: '501' },
    ])
  })

  it.each([
    [{ campaignId: '111;DROP' }],
    [{ campaignId: 'act_1' }],
    [{ campaignId: '111', adsetId: '../me' }],
  ])('a malformed id %o never reaches Meta', async (parent) => {
    mockGraph(() => ({ body: { data: [] } }))
    expect(await getAdsBreakdown('T', 'act_9', RANGE, parent)).toEqual({ ok: false, reason: 'permission_missing' })
    expect(calls).toHaveLength(0)
  })
})
