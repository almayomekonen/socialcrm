import { costPer, type AdsMetrics } from '@/lib/facebook/ads/metrics'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * "Results" per campaign, chosen by the campaign's OBJECTIVE — one metric per
 * row, never a sum of different kinds. Only documented objectives map to a
 * result; anything else (engagement without messaging, app promotion, legacy
 * objectives we cannot interpret) shows "—" rather than a guess.
 *
 * Meta's own `results` / `cost_per_result` Insights fields exist, but their
 * response shape is not documented (reference page unavailable, 2026-09-15), so
 * they are not parsed here until verified against a live response.
 *
 * Objectives: https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
 */

export type ResultKind = 'leads' | 'purchases' | 'link_clicks' | 'messaging' | 'reach'

const OBJECTIVE_RESULT: Record<string, ResultKind> = {
  OUTCOME_LEADS: 'leads',
  LEAD_GENERATION: 'leads',
  OUTCOME_SALES: 'purchases',
  CONVERSIONS: 'purchases',
  PRODUCT_CATALOG_SALES: 'purchases',
  OUTCOME_TRAFFIC: 'link_clicks',
  LINK_CLICKS: 'link_clicks',
  MESSAGES: 'messaging',
  OUTCOME_AWARENESS: 'reach',
  REACH: 'reach',
  BRAND_AWARENESS: 'reach',
}

export const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_LEADS: 'לידים',
  LEAD_GENERATION: 'לידים',
  OUTCOME_SALES: 'מכירות',
  CONVERSIONS: 'המרות',
  PRODUCT_CATALOG_SALES: 'מכירות מקטלוג',
  OUTCOME_TRAFFIC: 'תנועה',
  LINK_CLICKS: 'תנועה',
  OUTCOME_ENGAGEMENT: 'מעורבות',
  POST_ENGAGEMENT: 'מעורבות',
  MESSAGES: 'הודעות',
  OUTCOME_AWARENESS: 'מודעות',
  REACH: 'חשיפה',
  BRAND_AWARENESS: 'מודעות למותג',
  OUTCOME_APP_PROMOTION: 'קידום אפליקציה',
  APP_INSTALLS: 'התקנות אפליקציה',
  VIDEO_VIEWS: 'צפיות בסרטון',
}

export const RESULT_LABEL: Record<ResultKind, string> = {
  leads: 'לידים',
  purchases: 'רכישות',
  link_clicks: 'קליקים על קישור',
  messaging: 'שיחות שהתחילו',
  reach: 'אנשים שנחשפו',
}

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'פעיל',
  PAUSED: 'מושהה',
  CAMPAIGN_PAUSED: 'הקמפיין מושהה',
  ADSET_PAUSED: 'קבוצת המודעות מושהית',
  ARCHIVED: 'בארכיון',
  DELETED: 'נמחק',
  IN_PROCESS: 'בעיבוד',
  WITH_ISSUES: 'יש בעיות',
  PENDING_REVIEW: 'בבדיקה',
  DISAPPROVED: 'נדחה',
}

export type RowResult = {
  kind: ResultKind | null
  count: number | null
  /** Cost per result for THIS row; for reach, the cost per 1,000 people reached. */
  cost: number | null
}

const positive = (n: number | null) => (n ?? 0) > 0

export function resultKindFor(objective: string | null, metrics: AdsMetrics): ResultKind | null {
  if (!objective) return null
  const mapped = OBJECTIVE_RESULT[objective]
  // Leads and sales campaigns can convert somewhere other than their headline
  // action: a Leads campaign sending people to WhatsApp or Messenger reports
  // messaging conversations, a legacy Conversions campaign often optimised for a
  // pixel lead. Use the conversion the row actually produced, in this order, so
  // such a campaign never reads as "0 לידים" and never inflates cost per lead.
  if (mapped === 'leads') {
    if (positive(metrics.leads)) return 'leads'
    if (positive(metrics.messagingConversations)) return 'messaging'
    return 'leads'
  }
  if (mapped === 'purchases') {
    if (positive(metrics.purchases)) return 'purchases'
    if (positive(metrics.leads)) return 'leads'
    if (positive(metrics.messagingConversations)) return 'messaging'
    return 'purchases'
  }
  if (mapped) return mapped
  // Engagement campaigns that ran for messages have a documented messaging action.
  if (objective === 'OUTCOME_ENGAGEMENT' && positive(metrics.messagingConversations)) return 'messaging'
  return null
}

export function rowResult(objective: string | null, metrics: AdsMetrics): RowResult {
  const kind = resultKindFor(objective, metrics)
  if (!kind) return { kind: null, count: null, cost: null }
  if (kind === 'reach') {
    const reach = metrics.reach
    return { kind, count: reach, cost: reach && metrics.spend !== null ? (metrics.spend / reach) * 1000 : null }
  }
  const count =
    kind === 'leads'
      ? metrics.leads
      : kind === 'purchases'
        ? metrics.purchases
        : kind === 'link_clicks'
          ? metrics.linkClicks
          : metrics.messagingConversations
  return { kind, count, cost: kind === 'link_clicks' ? (metrics.linkCpc ?? costPer(metrics.spend, count)) : costPer(metrics.spend, count) }
}

const OBJECTIVE_KEY: Record<string, MessageKey> = {
  OUTCOME_LEADS: 'performance.adsIntel.objective.OUTCOME_LEADS',
  LEAD_GENERATION: 'performance.adsIntel.objective.LEAD_GENERATION',
  OUTCOME_SALES: 'performance.adsIntel.objective.OUTCOME_SALES',
  CONVERSIONS: 'performance.adsIntel.objective.CONVERSIONS',
  PRODUCT_CATALOG_SALES: 'performance.adsIntel.objective.PRODUCT_CATALOG_SALES',
  OUTCOME_TRAFFIC: 'performance.adsIntel.objective.OUTCOME_TRAFFIC',
  LINK_CLICKS: 'performance.adsIntel.objective.LINK_CLICKS',
  OUTCOME_ENGAGEMENT: 'performance.adsIntel.objective.OUTCOME_ENGAGEMENT',
  POST_ENGAGEMENT: 'performance.adsIntel.objective.POST_ENGAGEMENT',
  MESSAGES: 'performance.adsIntel.objective.MESSAGES',
  OUTCOME_AWARENESS: 'performance.adsIntel.objective.OUTCOME_AWARENESS',
  REACH: 'performance.adsIntel.objective.REACH',
  BRAND_AWARENESS: 'performance.adsIntel.objective.BRAND_AWARENESS',
  OUTCOME_APP_PROMOTION: 'performance.adsIntel.objective.OUTCOME_APP_PROMOTION',
  APP_INSTALLS: 'performance.adsIntel.objective.APP_INSTALLS',
  VIDEO_VIEWS: 'performance.adsIntel.objective.VIDEO_VIEWS',
}

const STATUS_KEY: Record<string, MessageKey> = {
  ACTIVE: 'performance.adsIntel.status.ACTIVE',
  PAUSED: 'performance.adsIntel.status.PAUSED',
  CAMPAIGN_PAUSED: 'performance.adsIntel.status.CAMPAIGN_PAUSED',
  ADSET_PAUSED: 'performance.adsIntel.status.ADSET_PAUSED',
  ARCHIVED: 'performance.adsIntel.status.ARCHIVED',
  DELETED: 'performance.adsIntel.status.DELETED',
  IN_PROCESS: 'performance.adsIntel.status.IN_PROCESS',
  WITH_ISSUES: 'performance.adsIntel.status.WITH_ISSUES',
  PENDING_REVIEW: 'performance.adsIntel.status.PENDING_REVIEW',
  DISAPPROVED: 'performance.adsIntel.status.DISAPPROVED',
}

const RESULT_KEY: Record<ResultKind, MessageKey> = {
  leads: 'performance.adsIntel.result.leads',
  purchases: 'performance.adsIntel.result.purchases',
  link_clicks: 'performance.adsIntel.result.linkClicks',
  messaging: 'performance.adsIntel.result.messaging',
  reach: 'performance.adsIntel.result.reach',
}

/**
 * Labels in the interface language. Hebrew reads the constants above (the
 * values every other reader has always seen); an unknown objective / status
 * code is shown as Meta returned it, exactly as before.
 */
export function objectiveLabel(objective: string, locale: UiLocale = 'he'): string {
  if (locale === 'he' || !OBJECTIVE_KEY[objective]) return OBJECTIVE_LABEL[objective] ?? objective
  return translatorFor(locale)(OBJECTIVE_KEY[objective])
}

export function resultLabel(kind: ResultKind, locale: UiLocale = 'he'): string {
  return locale === 'he' ? RESULT_LABEL[kind] : translatorFor(locale)(RESULT_KEY[kind])
}

export function adsStatusLabel(status: string, locale: UiLocale = 'he'): string {
  if (locale === 'he' || !STATUS_KEY[status]) return STATUS_LABEL[status] ?? status
  return translatorFor(locale)(STATUS_KEY[status])
}

const WINDOW_KEY: Record<string, MessageKey> = {
  '1d_click': 'performance.adsIntel.attribution.click1d',
  '7d_click': 'performance.adsIntel.attribution.click7d',
  '28d_click': 'performance.adsIntel.attribution.click28d',
  '1d_view': 'performance.adsIntel.attribution.view1d',
  '1d_ev': 'performance.adsIntel.attribution.engagedView1d',
}

/** Meta's attribution setting in words. Unknown values are shown as Meta returned them. */
export function attributionLabel(setting: string | null, locale: UiLocale = 'he'): string | null {
  if (!setting) return null
  const t = translatorFor(locale)
  if (setting === 'mixed') return t('performance.adsIntel.attribution.mixed')
  if (setting === 'default') return t('performance.adsIntel.attribution.default')
  const parts = setting.split(',').map((p) => (WINDOW_KEY[p.trim()] ? t(WINDOW_KEY[p.trim()]) : undefined))
  return parts.every(Boolean) ? (parts as string[]).reduce((a, b) => t('performance.adsIntel.attribution.or', { a, b })) : setting
}
