/**
 * Ad report arithmetic — the rules that decide whether a business owner can trust
 * the numbers: no double-counted leads, one purchase type, zero only when Meta's
 * data supports it, rates read per row (never averaged), objective-based results,
 * and comparison periods of equal length.
 */
import { describe, expect, it } from 'vitest'
import { costPer, metricsOf, returnOnAdSpend } from '@/lib/facebook/ads/metrics'
import { attributionLabel, rowResult } from '@/lib/facebook/ads/results'
import { dayCount, previousEquivalentRange, relativeChange } from '@/lib/facebook/ads/periods'
import { dailyTrend } from '@/lib/facebook/ads/report'
import { formatAdsChange, formatAdsPeriod } from '@/lib/facebook/ads/format'

const act = (type: string, value: string | number) => ({ action_type: type, value: String(value) })

describe('metricsOf — one Insights row', () => {
  it('reads Meta’s own values, labelled apart: all clicks vs link clicks, rates as returned', () => {
    const m = metricsOf({
      spend: '1500.25', impressions: '42000', reach: '18000', frequency: '2.33',
      clicks: '900', ctr: '2.14', cpc: '1.67', cpm: '35.72',
      inline_link_clicks: '610', inline_link_click_ctr: '1.45', cost_per_inline_link_click: '2.46',
      attribution_setting: '7d_click,1d_view',
    })
    expect(m).toMatchObject({
      spend: 1500.25, impressions: 42000, reach: 18000, frequency: 2.33,
      clicks: 900, ctr: 2.14, cpc: 1.67, cpm: 35.72,
      linkClicks: 610, linkCtr: 1.45, linkCpc: 2.46, attribution: '7d_click,1d_view',
    })
  })

  it('leads use the aggregate `lead` type ALONE — never added to its member types', () => {
    const m = metricsOf({
      impressions: '1000',
      actions: [act('onsite_conversion.lead_grouped', 30), act('offsite_conversion.fb_pixel_lead', 12), act('lead', 42), act('leadgen_grouped', 30)],
    })
    expect(m.leads).toBe(42)
  })

  it('purchases use ONE type (omni_purchase first) with its own value — never summed across types', () => {
    const m = metricsOf({
      impressions: '1000',
      actions: [act('offsite_conversion.fb_pixel_purchase', 9), act('omni_purchase', 10), act('onsite_conversion.purchase', 1)],
      action_values: [act('offsite_conversion.fb_pixel_purchase', 900), act('omni_purchase', 1000)],
    })
    expect(m.purchases).toBe(10)
    expect(m.purchaseValue).toBe(1000)
  })

  it('falls back to the pixel purchase type when omni_purchase is absent', () => {
    const m = metricsOf({ impressions: '10', actions: [act('offsite_conversion.fb_pixel_purchase', 3)], action_values: [act('offsite_conversion.fb_pixel_purchase', 450)] })
    expect(m).toMatchObject({ purchases: 3, purchaseValue: 450 })
  })

  it('zero only when the row delivered and Meta reported no such action; otherwise unknown', () => {
    expect(metricsOf({ impressions: '500', actions: [act('link_click', 4)] })).toMatchObject({ leads: 0, purchases: 0, purchaseValue: null })
    expect(metricsOf({ spend: '0' })).toMatchObject({ leads: null, purchases: null, reach: null, frequency: null })
    expect(metricsOf({ impressions: '', ctr: 'n/a' })).toMatchObject({ impressions: null, ctr: null })
  })
})

describe('derived values — per row, never averaged', () => {
  it('cost per result needs results; ROAS needs spend', () => {
    expect(costPer(300, 12)).toBe(25)
    expect(costPer(300, 0)).toBeNull()
    expect(costPer(null, 5)).toBeNull()
    expect(returnOnAdSpend(1000, 250)).toBe(4)
    expect(returnOnAdSpend(1000, 0)).toBeNull()
    expect(returnOnAdSpend(null, 250)).toBeNull()
  })
})

describe('rowResult — chosen by the campaign objective', () => {
  const base = metricsOf({
    spend: '600', impressions: '20000', reach: '8000', inline_link_clicks: '300', cost_per_inline_link_click: '2',
    actions: [act('lead', 20), act('omni_purchase', 4), act('onsite_conversion.messaging_conversation_started_7d', 15)],
  })

  it.each([
    ['OUTCOME_LEADS', 'leads', 20, 30],
    ['LEAD_GENERATION', 'leads', 20, 30],
    ['OUTCOME_SALES', 'purchases', 4, 150],
    ['OUTCOME_TRAFFIC', 'link_clicks', 300, 2],
    ['MESSAGES', 'messaging', 15, 40],
    ['OUTCOME_AWARENESS', 'reach', 8000, 75],
  ] as const)('%s → %s', (objective, kind, count, cost) => {
    expect(rowResult(objective, base)).toEqual({ kind, count, cost })
  })

  it('engagement counts messaging only when messaging conversations exist; otherwise no guessed result', () => {
    expect(rowResult('OUTCOME_ENGAGEMENT', base).kind).toBe('messaging')
    expect(rowResult('OUTCOME_ENGAGEMENT', metricsOf({ impressions: '10' }))).toEqual({ kind: null, count: null, cost: null })
  })

  it('a Leads campaign that converted in messaging reports conversations, not "0 leads"', () => {
    const messaging = metricsOf({ spend: '400', impressions: '9000', actions: [act('onsite_conversion.messaging_conversation_started_7d', 16)] })
    expect(rowResult('OUTCOME_LEADS', messaging)).toEqual({ kind: 'messaging', count: 16, cost: 25 })
  })

  it('a Sales/Conversions campaign without purchases but with leads reports leads', () => {
    const leadsOnly = metricsOf({ spend: '300', impressions: '5000', actions: [act('lead', 12)] })
    expect(rowResult('CONVERSIONS', leadsOnly)).toEqual({ kind: 'leads', count: 12, cost: 25 })
    expect(rowResult('OUTCOME_SALES', metricsOf({ spend: '50', impressions: '800' }))).toEqual({ kind: 'purchases', count: 0, cost: null })
  })

  it('an unknown or missing objective shows no result rather than a guess', () => {
    expect(rowResult('OUTCOME_APP_PROMOTION', base)).toEqual({ kind: null, count: null, cost: null })
    expect(rowResult(null, base)).toEqual({ kind: null, count: null, cost: null })
  })

  it('a lead campaign with delivery and no leads: 0 results, no cost per result', () => {
    expect(rowResult('OUTCOME_LEADS', metricsOf({ spend: '80', impressions: '3000' }))).toEqual({ kind: 'leads', count: 0, cost: null })
  })
})

describe('attribution in words', () => {
  it.each([
    ['7d_click,1d_view', '7 ימים מקליק או יום אחד מצפייה'],
    ['1d_click', 'יום אחד מקליק'],
    ['mixed', 'משתנה בין קבוצות המודעות'],
    ['something_new', 'something_new'],
  ])('%s → %s', (setting, label) => {
    expect(attributionLabel(setting)).toBe(label)
  })
})

describe('comparison period', () => {
  it('the equally long period immediately before, across month and leap-year boundaries', () => {
    expect(previousEquivalentRange({ since: '2026-08-16', until: '2026-09-14' })).toEqual({ since: '2026-07-17', until: '2026-08-15' })
    expect(previousEquivalentRange({ since: '2026-09-01', until: '2026-09-15' })).toEqual({ since: '2026-08-17', until: '2026-08-31' })
    expect(previousEquivalentRange({ since: '2028-03-01', until: '2028-03-07' })).toEqual({ since: '2028-02-23', until: '2028-02-29' })
    expect(dayCount({ since: '2026-09-15', until: '2026-09-15' })).toBe(1)
  })

  it('refuses malformed or reversed ranges', () => {
    expect(previousEquivalentRange({ since: '2026-09-10', until: '2026-09-01' })).toBeNull()
    expect(previousEquivalentRange({ since: '2026-02-30', until: '2026-03-02' })).toBeNull()
  })

  it('change is relative to the previous value; no percentage of nothing', () => {
    expect(formatAdsChange(relativeChange(120, 100))).toBe('+20%')
    expect(formatAdsChange(relativeChange(80, 100))).toBe('−20%')
    expect(relativeChange(50, 0)).toBeNull()
    expect(relativeChange(null, 10)).toBeNull()
    expect(formatAdsPeriod({ since: '2026-08-16', until: '2026-09-14' })).toBe('16.08.2026–14.09.2026')
  })
})

describe('daily trend — delivered day missing a field', () => {
  it('a delivered day without inline_link_clicks counts none, like a day Meta did not return', () => {
    const [day] = dailyTrend([{ date_start: '2026-09-01', spend: '12', impressions: '300' }], { since: '2026-09-01', until: '2026-09-01' })
    expect(day).toEqual({ date: '2026-09-01', spend: 12, impressions: 300, linkClicks: 0, leads: 0 })
  })
})

describe('daily trend', () => {
  it('one entry per day; a day Meta did not return had no delivery (0), and leads use `lead` only', () => {
    const days = dailyTrend(
      [
        { date_start: '2026-09-03', spend: '40', impressions: '1000', inline_link_clicks: '12', actions: [act('lead', 2), act('onsite_conversion.lead_grouped', 2)] },
        { date_start: '2026-09-01', spend: '55.5', impressions: '1400', inline_link_clicks: '20' },
      ],
      { since: '2026-09-01', until: '2026-09-03' },
    )
    expect(days).toEqual([
      { date: '2026-09-01', spend: 55.5, impressions: 1400, linkClicks: 20, leads: 0 },
      { date: '2026-09-02', spend: 0, impressions: 0, linkClicks: 0, leads: 0 },
      { date: '2026-09-03', spend: 40, impressions: 1000, linkClicks: 12, leads: 2 },
    ])
  })
})
