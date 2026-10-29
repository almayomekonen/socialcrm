// Today dashboard analytics — shared types and PURE helpers (no I/O, no clock).
// The SQL layer (db/reports/dashboardStats.ts) returns raw rows; everything that
// turns them into what the cards show lives here so it is unit-testable.

import type { UiLocale } from '@/lib/i18n/config'
import { intlLocale } from '@/lib/i18n/translate'
import { businessDateString } from '@/lib/today/time'
import { DAY_MS } from '@/lib/today/constants'
import { leadSourceChannel } from '@/lib/leads/leadSourceLabel'

export const DASHBOARD_RANGES = [7, 14, 30] as const
export type DashboardRange = (typeof DASHBOARD_RANGES)[number]
export const DEFAULT_RANGE: DashboardRange = 14

/** `?range=` → a supported range; anything else falls back to the default. */
export function parseDashboardRange(raw: unknown): DashboardRange {
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? (n as DashboardRange) : DEFAULT_RANGE
}

/** Dashboard source groups. Facebook + Instagram and manual + imported cannot be told apart reliably. */
export type SourceGroup = 'meta' | 'whatsapp' | 'website' | 'manual' | 'other'
export const SOURCE_ORDER: readonly SourceGroup[] = ['meta', 'whatsapp', 'website', 'manual', 'other']
export const SOURCE_LABEL: Record<SourceGroup, string> = {
  meta: 'פייסבוק / אינסטגרם',
  whatsapp: 'WhatsApp',
  website: 'אתר',
  manual: 'ידני / ייבוא',
  other: 'אחר',
}

/** Maps a stored `leadSource` (or its `channel:` prefix) to a dashboard group. */
export function sourceGroup(source: string | null | undefined): SourceGroup {
  const channel = leadSourceChannel(source)
  if (channel === 'facebook' || channel === 'instagram') return 'meta'
  if (channel === 'whatsapp' || channel === 'website' || channel === 'manual') return channel
  return 'other'
}

export type DayPoint = { day: string; newLeads: number; replied: number }
export type SourceSlice = { key: SourceGroup; label: string; count: number }
export type FunnelStage = { key: string; label: string; count: number }

export type DashboardStats = {
  range: DashboardRange
  days: DayPoint[]
  newLeads: { total: number; prevTotal: number }
  replied: { total: number; prevTotal: number }
  /** Average minutes to the first human WhatsApp reply; null when nothing was measurable. */
  responseMinutes: { avg: number | null; prevAvg: number | null; daily: (number | null)[] }
  revenue: { total: number; prevTotal: number; deals: number; daily: number[] } | null
  sources: SourceSlice[]
  funnel: FunnelStage[]
  lost: number
  /** closed / (closed + lost); null when no lead has reached either. */
  closeRate: number | null
}

/** Business-day keys (YYYY-MM-DD, Asia/Jerusalem) for the current and previous windows, oldest first. */
export function rangeWindows(range: DashboardRange, nowMs: number) {
  const key = (offset: number) => businessDateString(nowMs - offset * DAY_MS)
  const current = Array.from({ length: range }, (_, i) => key(range - 1 - i))
  const previous = Array.from({ length: range }, (_, i) => key(2 * range - 1 - i))
  return { current, previous }
}

/** Relative change in %, rounded; null when there is no baseline to compare against. */
export function percentDelta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/** Minutes → "h:mm" (e.g. 102 → "1:42"). */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const FUNNEL_STAGES: readonly { key: string; label: string }[] = [
  { key: 'new', label: 'חדש' },
  { key: 'contacted', label: 'בטיפול' },
  { key: 'interested', label: 'מעוניין' },
  { key: 'closed', label: 'סגור' },
]

/** Current status counts → the four funnel stages, `lost` outside the funnel. */
export function buildFunnel(byStatus: Record<string, number>) {
  const funnel = FUNNEL_STAGES.map((s) => ({ ...s, count: byStatus[s.key] ?? 0 }))
  const lost = byStatus.lost ?? 0
  const closed = byStatus.closed ?? 0
  const closeRate = closed + lost > 0 ? closed / (closed + lost) : null
  return { funnel, lost, closeRate }
}

const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

/** "2026-10-22" → { short: "22.10", long: "יום ה׳ · 22.10" }. Pure: derived from the key, no clock. */
export function dayLabels(key: string, locale: UiLocale = 'he') {
  const [y, m, d] = key.split('-').map(Number)
  const noon = new Date(Date.UTC(y, m - 1, d, 12))
  if (locale === 'he') {
    const short = `${d}.${m}`
    return { short, long: `יום ${WEEKDAY[noon.getUTCDay()]} · ${short}` }
  }
  // `key` is a calendar date, not an instant: format it in UTC so no zone can
  // shift it to a neighbouring day.
  const tag = intlLocale(locale)
  const short = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(noon)
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' }).format(noon)
  return { short, long: `${weekday} · ${short}` }
}
