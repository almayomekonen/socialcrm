/**
 * Fixtures + mutable state behind the /sum_sales/ads i18n tests (Phase E2).
 *
 * Campaign, ad set, ad and account names are EXTERNAL (Meta) data and are
 * Hebrew on purpose here: they must reach the screen untouched. Meta's numbers
 * are fixtures; the report / breakdown / intelligence shapes are built with the
 * REAL `metricsOf` / `rowResult` / `adsSignals`, so every label producer runs.
 */
import { metricsOf } from '@/lib/facebook/ads/metrics'
import { rowResult } from '@/lib/facebook/ads/results'
import { adsSignals } from '@/lib/facebook/ads/signals'
import { EMPTY_OUTCOME } from '@/lib/facebook/ads/crmOutcomes'
import type { AdsReport } from '@/lib/facebook/ads/report'
import type { AdsBreakdown } from '@/lib/facebook/ads/breakdown'
import type { AdsIntelligenceData } from '@/lib/facebook/ads/intelligence'

const act = (type: string, value: number) => ({ action_type: type, value: String(value) })
const row = (id: string, name: string, objective: string | null, raw: Record<string, unknown>, status: string | null = 'ACTIVE') => {
  const metrics = metricsOf(raw)
  return { id, name, objective, status, metrics, result: rowResult(objective, metrics) }
}

export const CAMPAIGNS = [
  row('111', 'קמפיין לידים ספטמבר', 'OUTCOME_LEADS', { spend: '600', impressions: '30000', reach: '15000', inline_link_clicks: '300', inline_link_click_ctr: '1', actions: [act('lead', 20)] }),
  row('222', 'קמפיין מיתוג', 'OUTCOME_AWARENESS', { spend: '400', impressions: '20000', reach: '10000' }, 'PAUSED'),
  row('333', 'קמפיין מכירות', 'OUTCOME_SALES', { spend: '300', impressions: '9000', reach: '5000', actions: [act('omni_purchase', 3)], action_values: [act('omni_purchase', 900)] }, 'CAMPAIGN_PAUSED'),
  row('444', 'קמפיין תנועה', 'OUTCOME_TRAFFIC', { spend: '150', impressions: '7000', reach: '4000', inline_link_clicks: '90' }, null),
  row('555', 'קמפיין מעורבות', 'OUTCOME_ENGAGEMENT', { spend: '0', impressions: '100' }, 'WITH_ISSUES'),
  row('666', 'קמפיין הודעות', 'MESSAGES', { spend: '80', actions: [act('onsite_conversion.messaging_conversation_started_7d', 4)] }, 'ARCHIVED'),
  row('777', 'קמפיין לידים ריק', 'OUTCOME_LEADS', { spend: '200', impressions: '3000', actions: [act('lead', 0)] }),
]

export const TOTALS = metricsOf({
  spend: '1730', impressions: '69100', reach: '34000', frequency: '2.03', clicks: '900', ctr: '1.3', cpc: '1.92', cpm: '25',
  inline_link_clicks: '390', inline_link_click_ctr: '0.56', cost_per_inline_link_click: '4.44',
  actions: [act('lead', 20), act('omni_purchase', 3), act('onsite_conversion.messaging_conversation_started_7d', 4)],
  action_values: [act('omni_purchase', 900)],
  attribution_setting: '7d_click,1d_view',
})

export function report(over: Partial<AdsReport> = {}): AdsReport {
  return {
    period: { since: '2026-09-15', until: '2026-10-14' },
    totals: TOTALS,
    previous: { period: { since: '2026-08-16', until: '2026-09-14' }, totals: metricsOf({ spend: '1500', impressions: '60000', reach: '0', actions: [act('lead', 25)] }) },
    daily: [
      { date: '2026-10-13', spend: 50, linkClicks: 10, leads: 1 },
      { date: '2026-10-14', spend: 80, linkClicks: 14, leads: 2 },
    ],
    campaigns: CAMPAIGNS,
    statusesAvailable: true,
    reducedFields: true,
    ...over,
  } as AdsReport
}

export const ADSET_BREAKDOWN: AdsBreakdown = {
  level: 'adset',
  campaign: { id: '111', name: 'קמפיין לידים ספטמבר' },
  adset: null,
  rows: [row('811', 'קהל חם', null, { spend: '300', actions: [act('lead', 12)] }) as never],
  statusesAvailable: true,
}
export const AD_BREAKDOWN: AdsBreakdown = {
  level: 'ad',
  campaign: { id: '111', name: null },
  adset: { id: '811', name: null },
  rows: [row('901', 'מודעת תמונה', null, { spend: '120' }) as never],
  statusesAvailable: false,
}

const OUTCOMES = {
  campaign: { '111': { ...EMPTY_OUTCOME, captured: 18, contacted: 6, interested: 3, closed: 2, untouched: 7 } },
  adset: { '811': { ...EMPTY_OUTCOME, captured: 9, contacted: 9 } },
  ad: { '901': { ...EMPTY_OUTCOME, captured: 5, contacted: 5 } },
}

/** The REAL signal producer, in the locale the page asks for (the locale arg is ignored before Phase E2). */
export function intel(locale?: string, over: Partial<AdsIntelligenceData> = {}): AdsIntelligenceData {
  const signals = (adsSignals as (...a: unknown[]) => AdsIntelligenceData['signals'])(
    [
      { id: '111', name: 'קמפיין לידים ספטמבר', spend: 600, metaLeads: 20, leadObjective: true, crm: OUTCOMES.campaign['111'] },
      { id: '777', name: 'קמפיין לידים ריק', spend: 200, metaLeads: 0, leadObjective: true, crm: { ...EMPTY_OUTCOME, captured: 1, untouched: 1 } },
    ],
    'ILS',
    ...(locale ? [locale] : []),
  )
  return {
    outcomes: OUTCOMES,
    signals,
    topAds: [
      { id: '901', name: 'מודעת תמונה', campaignId: '111', campaignName: 'קמפיין לידים ספטמבר', adsetId: null, adsetName: null, ...pick(row('901', '', 'OUTCOME_LEADS', { spend: '300', actions: [act('lead', 10)] })) },
      { id: '902', name: 'מודעת וידאו', campaignId: '111', campaignName: 'קמפיין לידים ספטמבר', adsetId: null, adsetName: null, ...pick(row('902', '', 'OUTCOME_LEADS', { spend: '200' })) },
    ],
    creatives: { '901': { imageUrl: 'https://cdn.test/ad.jpg', isVideo: false }, '902': { imageUrl: 'https://cdn.test/video.jpg', isVideo: true } },
    freshness: { fetchedAt: '2026-10-15T06:30:00.000Z', stale: true },
    outsideReport: 4,
    ...over,
  } as AdsIntelligenceData
}
const pick = (r: { metrics: unknown; result: unknown }) => ({ metrics: r.metrics, result: r.result })

export const CRM_ONLY_GROUPS = [
  { id: '111', name: 'קמפיין לידים ספטמבר', outcome: { ...EMPTY_OUTCOME, captured: 7, untouched: 2, contacted: 5 } },
  { id: '999', name: null, outcome: { ...EMPTY_OUTCOME, captured: 1, untouched: 1 } },
]

export const ACCOUNTS = [
  { id: 'act_1', name: 'חשבון ראשי', currency: 'ILS', timezone: 'Asia/Jerusalem', status: 1 },
  { id: 'act_2', name: 'Second', currency: 'USD', timezone: null, status: 1 },
]

export const CONNECTED = { id: 1, token: 'server-only', grantedScopes: ['ads_read'], tokenExpiresAt: null, selectedAccountId: 'act_1' }

export const ADS_DEFAULTS = {
  connection: CONNECTED as Record<string, unknown> | null,
  connectionThrows: false,
  accounts: { ok: true, value: ACCOUNTS } as Record<string, unknown>,
  report: { ok: true, value: report() } as Record<string, unknown>,
  breakdown: { ok: true, value: ADSET_BREAKDOWN } as Record<string, unknown>,
  intel: true,
  crmOnly: CRM_ONLY_GROUPS as unknown[],
}
export const adsEnv = { ...ADS_DEFAULTS }
export function resetAdsEnv() {
  Object.assign(adsEnv, ADS_DEFAULTS)
}

/** External (Meta) text the report shows verbatim. */
export const ADS_EXTERNAL = [
  ...CAMPAIGNS.map((c) => c.name),
  'קהל חם',
  'מודעת תמונה',
  'מודעת וידאו',
  'חשבון ראשי',
]
