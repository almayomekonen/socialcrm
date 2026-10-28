import { db } from '@/config/db'
import { scopedLeads, type Scope } from '@/db/briefing'
import { getPermsAndFilter } from '@/db/filter'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { BUSINESS_TZ } from '@/lib/today/constants'
import type { UserDb } from '@/db/auth'
import { getRepliedLeadDays, getResponseTimeByDay } from './dashboardMessaging'
import {
  SOURCE_LABEL,
  SOURCE_ORDER,
  buildFunnel,
  rangeWindows,
  sourceGroup,
  type DashboardRange,
  type DashboardStats,
  type SourceGroup,
} from '@/lib/dashboard/stats'

// Today dashboard analytics — read-only. Leads are scoped by `scopedLeads` (the
// same agency / permission / quota scope as the Today brief); revenue by
// `getPermsAndFilter` (the same scope as ביצועים). No writes, no schema changes.

// clients."createdAt" is a timestamp without time zone holding UTC.
const LEAD_DAY = `to_char((clients."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ?, 'YYYY-MM-DD')`

type LeadDayRow = { day: string; src: string; composite: boolean; n: number }

async function leadsByDayAndSource(agencyId: number, plan: string, scope: Scope, fromKey: string) {
  const rows = (await scopedLeads(agencyId, plan, scope)
    .whereRaw(`clients."createdAt" >= (?::date - 1)`, [fromKey])
    .select(
      db.raw(`${LEAD_DAY} AS day`, [BUSINESS_TZ]),
      db.raw(`lower(split_part(COALESCE(clients."leadSource", ''), ':', 1)) AS src`),
      db.raw(`position(':' in COALESCE(clients."leadSource", '')) > 0 AS composite`),
      db.raw('COUNT(*)::int AS n'),
    )
    .groupByRaw('1, 2, 3')) as LeadDayRow[]
  return rows.filter((r) => r.day >= fromKey)
}

async function leadsByStatus(agencyId: number, plan: string, scope: Scope) {
  const rows = (await scopedLeads(agencyId, plan, scope)
    .select('clients.status as status', db.raw('COUNT(*)::int AS n'))
    .groupBy('clients.status')) as { status: string | null; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.status ?? '', Number(r.n)]))
}

/** Paid sales per offer day — the ביצועים definition of revenue, scoped by its filter. */
async function revenueByDay(user: UserDb, fromKey: string) {
  const filter = JSON.stringify({ dateRange: 'כל התאריכים', status: ['שולם'] })
  const { sqlFilter } = await getPermsAndFilter({ filter, user })
  const rows = (await sqlFilter.sql
    .table('_flat_sales')
    .whereRaw(`"offrDt" >= ?::date`, [fromKey])
    .select(db.raw(`to_char("offrDt", 'YYYY-MM-DD') AS day`), db.raw('SUM(amount)::float AS amount'), db.raw('COUNT(*)::int AS n'))
    .groupByRaw('1')) as { day: string; amount: number; n: number }[]
  return rows
}

export type DashboardViewer = { user: UserDb; scope: Scope; agencyId: number }

export async function getDashboardStats(viewer: DashboardViewer, range: DashboardRange, nowMs: number): Promise<DashboardStats> {
  const { current, previous } = rangeWindows(range, nowMs)
  const fromKey = previous[0]
  const curStart = current[0]
  const { agencyId, scope } = viewer
  const plan = await getEffectiveLeadPlan(agencyId)
  const scopedIds = scopedLeads(agencyId, plan, scope).select('clients.id')

  const [leadRows, byStatus, replied, response, revenue] = await Promise.all([
    leadsByDayAndSource(agencyId, plan, scope, fromKey),
    leadsByStatus(agencyId, plan, scope),
    getRepliedLeadDays(agencyId, scopedIds, fromKey),
    getResponseTimeByDay(agencyId, scopedIds, fromKey),
    revenueByDay(viewer.user, fromKey),
  ])

  const inCur = (day: string) => day >= curStart
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  const newByDay = new Map<string, number>()
  const bySource = new Map<SourceGroup, number>()
  for (const r of leadRows) {
    newByDay.set(r.day, (newByDay.get(r.day) ?? 0) + r.n)
    if (!inCur(r.day)) continue
    const group = sourceGroup(r.composite ? `${r.src}:` : r.src)
    bySource.set(group, (bySource.get(group) ?? 0) + r.n)
  }

  const repliedByDay = new Map<string, number>()
  const curLeads = new Set<number>()
  const prevLeads = new Set<number>()
  for (const r of replied) {
    repliedByDay.set(r.day, (repliedByDay.get(r.day) ?? 0) + 1)
    ;(inCur(r.day) ? curLeads : prevLeads).add(r.leadId)
  }

  const weightedAvg = (rows: typeof response) => {
    const n = sum(rows.map((r) => r.n))
    return n ? sum(rows.map((r) => r.minutes * r.n)) / n : null
  }
  const responseByDay = new Map(response.map((r) => [r.day, r.minutes]))

  const revenueByDayMap = new Map(revenue.map((r) => [r.day, r.amount]))
  const curRevenue = revenue.filter((r) => inCur(r.day))
  const hasSales = revenue.length > 0

  const prevNew = sum(previous.map((d) => newByDay.get(d) ?? 0))
  const curNew = sum(current.map((d) => newByDay.get(d) ?? 0))

  return {
    range,
    days: current.map((day) => ({ day, newLeads: newByDay.get(day) ?? 0, replied: repliedByDay.get(day) ?? 0 })),
    newLeads: { total: curNew, prevTotal: prevNew },
    replied: { total: curLeads.size, prevTotal: prevLeads.size },
    responseMinutes: {
      avg: weightedAvg(response.filter((r) => inCur(r.day))),
      prevAvg: weightedAvg(response.filter((r) => !inCur(r.day))),
      daily: current.map((d) => responseByDay.get(d) ?? null),
    },
    revenue: hasSales
      ? {
          total: sum(curRevenue.map((r) => r.amount)),
          prevTotal: sum(revenue.filter((r) => !inCur(r.day)).map((r) => r.amount)),
          deals: sum(curRevenue.map((r) => r.n)),
          daily: current.map((d) => revenueByDayMap.get(d) ?? 0),
        }
      : null,
    sources: SOURCE_ORDER.map((key) => ({ key, label: SOURCE_LABEL[key], count: bySource.get(key) ?? 0 })).filter((s) => s.count > 0),
    ...buildFunnel(byStatus),
  }
}
