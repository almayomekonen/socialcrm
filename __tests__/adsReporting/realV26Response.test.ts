/**
 * A REAL Marketing API v26.0 account-level Insights row (agency 103, internal;
 * last_30d resolved 2026-09-05 → 2026-10-04), captured by hand in Graph API
 * Explorer on 2026-10-05 and sanitised (ids removed). It is the evidence that
 * settled what Meta returns for the exact field list SocialCRM requests — and
 * this test pins that SocialCRM parses it without losing anything.
 */
import { describe, expect, it, vi } from 'vitest'
import { metricsOf } from '@/lib/facebook/ads/metrics'
import { rowResult } from '@/lib/facebook/ads/results'

export const REAL_V26_ACCOUNT_ROW = {
  spend: '1545.92',
  impressions: '10263',
  reach: '4623',
  frequency: '2.219987',
  clicks: '263',
  ctr: '2.562604',
  cpc: '5.878023',
  cpm: '150.63042',
  inline_link_clicks: '148',
  inline_link_click_ctr: '1.442073',
  cost_per_inline_link_click: '10.445405',
  attribution_setting: 'multiple',
  actions: [
    { action_type: 'lead', value: '2' },
    { action_type: 'onsite_web_lead', value: '2' },
    { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' },
    { action_type: 'offsite_lead_add_20_s_calls', value: '2' },
    { action_type: 'link_click', value: '148' },
    { action_type: 'landing_page_view', value: '102' },
    { action_type: 'complete_registration', value: '12' },
    { action_type: 'video_view', value: '2387' },
  ],
  cost_per_action_type: [{ action_type: 'lead', value: '772.96' }],
  date_start: '2026-09-05',
  date_stop: '2026-10-04',
}

describe('real v26.0 response → metrics', () => {
  const m = metricsOf(REAL_V26_ACCOUNT_ROW)

  it('keeps every number Meta returned', () => {
    expect(m).toMatchObject({
      spend: 1545.92,
      impressions: 10263,
      reach: 4623,
      frequency: 2.219987,
      clicks: 263,
      ctr: 2.562604,
      cpc: 5.878023,
      cpm: 150.63042,
      linkClicks: 148,
      linkCtr: 1.442073,
      linkCpc: 10.445405,
      attribution: 'multiple',
    })
  })

  it('Meta leads = the top-level `lead` action (2) — its subtypes are never added to it', () => {
    expect(m.leads).toBe(2)
  })

  it("Meta CPL = spend ÷ Meta leads = 772.96, matching Meta's own cost_per_action_type for `lead`", () => {
    const r = rowResult('OUTCOME_LEADS', m)
    expect(r.kind).toBe('leads')
    expect(r.count).toBe(2)
    expect(r.cost).toBeCloseTo(772.96, 2)
  })

  it('a field Meta did not return stays unknown — never 0', () => {
    const { impressions: _i, reach: _r, ...withoutDelivery } = REAL_V26_ACCOUNT_ROW
    const partial = metricsOf(withoutDelivery)
    expect(partial.impressions).toBeNull()
    expect(partial.reach).toBeNull()
    expect(partial.spend).toBe(1545.92)
  })

  it('a missing action is a real 0 only when the row proves delivery', () => {
    const noLeads = { ...REAL_V26_ACCOUNT_ROW, actions: [{ action_type: 'link_click', value: '148' }] }
    expect(metricsOf(noLeads).leads).toBe(0)
    const { impressions: _i, ...noDeliveryProof } = noLeads
    expect(metricsOf(noDeliveryProof).leads).toBeNull()
  })

  it('a "0" Meta returned is a zero, not unknown', () => {
    expect(metricsOf({ ...REAL_V26_ACCOUNT_ROW, clicks: '0' }).clicks).toBe(0)
  })
})

describe('real v26.0 response → full account report', () => {
  it('getAdsReport carries the real totals through unchanged', async () => {
    vi.resetModules()
    vi.doMock('@/lib/facebook/ads/insights', async (orig) => {
      const actual = await orig<typeof import('@/lib/facebook/ads/insights')>()
      return {
        ...actual,
        readInsights: async (_t: string, _a: string, q: Record<string, unknown>) =>
          q.level === 'account' && !q.time_increment && !q.time_range
            ? { ok: true, value: [REAL_V26_ACCOUNT_ROW] }
            : { ok: true, value: [] },
        readStatuses: async () => new Map(),
      }
    })
    const { getAdsReport } = await import('@/lib/facebook/ads/report')
    const res = await getAdsReport('t', 'act_1', { kind: 'preset', preset: 'last_30d' }, { today: '2026-10-05' })
    expect('value' in res && res.value.totals).toMatchObject({
      spend: 1545.92,
      impressions: 10263,
      reach: 4623,
      clicks: 263,
      ctr: 2.562604,
      leads: 2,
    })
    expect('value' in res && res.value.period).toEqual({ since: '2026-09-05', until: '2026-10-04' })
    vi.doUnmock('@/lib/facebook/ads/insights')
  })
})
