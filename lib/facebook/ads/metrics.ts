/**
 * One Insights row → the numbers the report shows. Pure; no Graph calls.
 *
 * CORRECTNESS RULES (Meta Marketing API docs, checked 2026-09-15):
 *  · Every number is Meta's own per-row value. Rates (CTR, CPC, CPM, frequency)
 *    are read, never averaged across rows; reach is deduplicated per row and is
 *    never summed across campaigns or days.
 *  · Action types are HIERARCHICAL. `lead` is "all offsite leads plus all
 *    On-Facebook leads", so it is used alone and never added to its members.
 *    Purchases use ONE type — the first present of PURCHASE_TYPES.
 *    https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/
 *  · A missing value stays null ("—"). An action count is 0 only when the row
 *    delivered (impressions > 0) and Meta reported no such action — Meta omits
 *    zero-valued actions.
 */

export type AdsMetrics = {
  spend: number | null
  impressions: number | null
  reach: number | null
  frequency: number | null
  /** All clicks (any click on the ad). */
  clicks: number | null
  ctr: number | null
  cpc: number | null
  cpm: number | null
  /** Clicks to the ad's destination. Meta counts these with a fixed 1-day-click window. */
  linkClicks: number | null
  linkCtr: number | null
  linkCpc: number | null
  leads: number | null
  purchases: number | null
  purchaseValue: number | null
  messagingConversations: number | null
  /** The attribution setting Meta applied to this row (e.g. "7d_click,1d_view", "mixed"). */
  attribution: string | null
}

export const LEAD_TYPE = 'lead'
export const PURCHASE_TYPES = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'] as const
export const MESSAGING_TYPE = 'onsite_conversion.messaging_conversation_started_7d'

export const toNumber = (v: unknown): number | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** `actions` / `action_values` → action_type → value. Duplicate types keep the first (never summed). */
export function actionMap(list: unknown): Map<string, number> {
  const map = new Map<string, number>()
  if (!Array.isArray(list)) return map
  for (const item of list) {
    const type = (item as { action_type?: unknown })?.action_type
    const value = toNumber((item as { value?: unknown })?.value)
    if (typeof type === 'string' && value !== null && !map.has(type)) map.set(type, value)
  }
  return map
}

function actionCount(actions: Map<string, number>, type: string, delivered: boolean): number | null {
  if (actions.has(type)) return actions.get(type)!
  return delivered ? 0 : null
}

export function metricsOf(row: Record<string, unknown> | undefined): AdsMetrics {
  const impressions = toNumber(row?.impressions)
  const delivered = impressions !== null && impressions > 0
  const actions = actionMap(row?.actions)
  const values = actionMap(row?.action_values)
  const purchaseType = PURCHASE_TYPES.find((t) => actions.has(t) || values.has(t))
  const attribution = row?.attribution_setting

  return {
    spend: toNumber(row?.spend),
    impressions,
    reach: toNumber(row?.reach),
    frequency: toNumber(row?.frequency),
    clicks: toNumber(row?.clicks),
    ctr: toNumber(row?.ctr),
    cpc: toNumber(row?.cpc),
    cpm: toNumber(row?.cpm),
    linkClicks: toNumber(row?.inline_link_clicks),
    linkCtr: toNumber(row?.inline_link_click_ctr),
    linkCpc: toNumber(row?.cost_per_inline_link_click),
    leads: actionCount(actions, LEAD_TYPE, delivered),
    purchases: purchaseType ? (actions.get(purchaseType) ?? (delivered ? 0 : null)) : delivered ? 0 : null,
    purchaseValue: purchaseType ? (values.get(purchaseType) ?? null) : null,
    messagingConversations: actionCount(actions, MESSAGING_TYPE, delivered),
    attribution: typeof attribution === 'string' && attribution ? attribution : null,
  }
}

/** Spend ÷ count for ONE row. Null when either is unknown or there were no results (no cost per nothing). */
export function costPer(spend: number | null, count: number | null): number | null {
  if (spend === null || count === null || count <= 0) return null
  return spend / count
}

/** Conversion value ÷ spend for ONE row — never an average of other rows' ROAS. */
export function returnOnAdSpend(value: number | null, spend: number | null): number | null {
  if (value === null || spend === null || spend <= 0) return null
  return value / spend
}

/** The fields every report row asks Meta for. */
export const ROW_FIELDS = [
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'inline_link_clicks',
  'inline_link_click_ctr',
  'cost_per_inline_link_click',
  'actions',
  'action_values',
  'attribution_setting',
] as const
