// @vitest-environment jsdom
//
// Today dashboard analytics — pure helpers and the analytics cards.
//
// The cards must never show a number the data does not support: no delta without
// a baseline, no response-time card without a measured reply, no revenue card
// without sales, and no funnel when there are no leads.

import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import {
  buildFunnel,
  dayLabels,
  formatDuration,
  parseDashboardRange,
  percentDelta,
  rangeWindows,
  sourceGroup,
  type DashboardStats,
} from '@/lib/dashboard/stats'
import AnalyticsOverview from '@/components/home/dashboard/AnalyticsOverview'
import FunnelCard from '@/components/home/dashboard/FunnelCard'
import LeadsTrendChart from '@/components/home/dashboard/LeadsTrendChart'

afterEach(() => cleanup())

describe('lib/dashboard/stats', () => {
  it('parses ?range= strictly, defaulting to 14', () => {
    expect(parseDashboardRange('7')).toBe(7)
    expect(parseDashboardRange(['30'])).toBe(30)
    expect(parseDashboardRange('90')).toBe(14)
    expect(parseDashboardRange(undefined)).toBe(14)
    expect(parseDashboardRange('abc')).toBe(14)
  })

  it('builds business-day windows in Asia/Jerusalem, oldest first', () => {
    // 2026-10-27 22:30 UTC is already 2026-10-28 in Jerusalem (UTC+2 after DST).
    const { current, previous } = rangeWindows(7, Date.UTC(2026, 9, 27, 22, 30))
    expect(current).toHaveLength(7)
    expect(current[6]).toBe('2026-10-28')
    expect(current[0]).toBe('2026-10-22')
    expect(previous[6]).toBe('2026-10-21')
    expect(previous[0]).toBe('2026-10-15')
  })

  it('groups sources: Facebook + Instagram together, manual + empty together, unknown → other', () => {
    expect(sourceGroup('facebook:')).toBe('meta')
    expect(sourceGroup('instagram:')).toBe('meta')
    expect(sourceGroup('facebook_comment:')).toBe('meta')
    expect(sourceGroup('whatsapp:')).toBe('whatsapp')
    expect(sourceGroup('contact_form_7:')).toBe('website')
    expect(sourceGroup('')).toBe('manual')
    expect(sourceGroup('ידני')).toBe('manual')
    expect(sourceGroup('המלצה מחבר')).toBe('other')
  })

  it('deltas need a baseline; durations render as h:mm', () => {
    expect(percentDelta(118, 100)).toBe(18)
    expect(percentDelta(76, 100)).toBe(-24)
    expect(percentDelta(5, 0)).toBeNull()
    expect(percentDelta(null, 10)).toBeNull()
    expect(formatDuration(102)).toBe('1:42')
    expect(formatDuration(9)).toBe('0:09')
  })

  it('funnel = the four real statuses; lost outside; close rate = closed / (closed + lost)', () => {
    const f = buildFunnel({ new: 10, contacted: 6, interested: 3, closed: 2, lost: 6, true: 4 })
    expect(f.funnel.map((s) => [s.label, s.count])).toEqual([['חדש', 10], ['בטיפול', 6], ['מעוניין', 3], ['סגור', 2]])
    expect(f.lost).toBe(6)
    expect(f.closeRate).toBe(0.25)
    expect(buildFunnel({ new: 3 }).closeRate).toBeNull()
  })

  it('day labels come from the key, not a clock', () => {
    expect(dayLabels('2026-10-22')).toEqual({ short: '22.10', long: 'יום ה׳ · 22.10' })
  })
})

const stats = (over: Partial<DashboardStats> = {}): DashboardStats => ({
  range: 14,
  days: [
    { day: '2026-10-27', newLeads: 4, replied: 2 },
    { day: '2026-10-28', newLeads: 6, replied: 3 },
  ],
  newLeads: { total: 10, prevTotal: 8 },
  replied: { total: 5, prevTotal: 0 },
  responseMinutes: { avg: 102, prevAvg: 134, daily: [90, 110] },
  revenue: { total: 48250, prevTotal: 36000, deals: 3, daily: [0, 48250] },
  sources: [
    { key: 'meta', label: 'פייסבוק / אינסטגרם', count: 6 },
    { key: 'whatsapp', label: 'WhatsApp', count: 4 },
  ],
  funnel: [
    { key: 'new', label: 'חדש', count: 10 },
    { key: 'contacted', label: 'בטיפול', count: 6 },
    { key: 'interested', label: 'מעוניין', count: 3 },
    { key: 'closed', label: 'סגור', count: 1 },
  ],
  lost: 2,
  closeRate: 1 / 3,
  ...over,
})

describe('AnalyticsOverview', () => {
  it('renders the four KPIs with honest deltas and scoped labels', async () => {
    render(await AnalyticsOverview({ stats: Promise.resolve(stats()) }))
    const kpis = within(screen.getByRole('region', { name: 'מדדים' }))
    expect(kpis.getByText('לידים חדשים')).toBeTruthy()
    expect(screen.getByText('+25%')).toBeTruthy()
    expect(screen.getByText('מענה ב־WhatsApp ו־Messenger')).toBeTruthy()
    expect(screen.getByText('1:42')).toBeTruthy()
    // Response time fell 24% — good, so success tone.
    expect(screen.getByText('−24%').className).toContain('bg-success-bg')
    expect(screen.getByText('הכנסות ב־14 ימים')).toBeTruthy()
    expect(screen.getByText('3 עסקאות שולמו')).toBeTruthy()
    expect(screen.getByText('+34%')).toBeTruthy() // revenue 48,250 vs 36,000
    // replied has no baseline (prev 0) → its card has no delta chip at all.
    const repliedCard = kpis.getByText('לידים שנענו').closest('div')!.parentElement!
    expect(repliedCard.textContent).not.toMatch(/%/)
  })

  it('omits cards and blocks that have nothing true to show', async () => {
    render(
      await AnalyticsOverview({
        stats: Promise.resolve(
          stats({
            days: [{ day: '2026-10-28', newLeads: 0, replied: 0 }],
            newLeads: { total: 0, prevTotal: 0 },
            replied: { total: 0, prevTotal: 0 },
            responseMinutes: { avg: null, prevAvg: null, daily: [null] },
            revenue: null,
            sources: [],
          }),
        ),
      }),
    )
    expect(within(screen.getByRole('region', { name: 'מדדים' })).getByText('לידים חדשים')).toBeTruthy()
    expect(screen.queryByText('לידים שנענו')).toBeNull()
    expect(screen.queryByText('זמן תגובה ממוצע')).toBeNull()
    expect(screen.queryByText(/הכנסות/)).toBeNull()
    expect(screen.queryByText('מקורות לידים')).toBeNull()
    expect(screen.getByText('אין לידים חדשים בתקופה הזו')).toBeTruthy()
  })

  it('hides the replies line and its legend when nobody was answered in the period', async () => {
    const days = [
      { day: '2026-10-27', newLeads: 2, replied: 0 },
      { day: '2026-10-28', newLeads: 1, replied: 0 },
    ]
    render(await AnalyticsOverview({ stats: Promise.resolve(stats({ days, replied: { total: 0, prevTotal: 0 } })) }))
    expect(screen.queryByText('נענו (WhatsApp / Messenger)')).toBeNull()
    expect(screen.getByRole('group').querySelector('path.stroke-success')).toBeNull()
  })

  it('range tabs are links that carry ?range= and mark the current one', async () => {
    render(await AnalyticsOverview({ stats: Promise.resolve(stats({ range: 7 })) }))
    expect(screen.getByRole('link', { name: '7 ימים' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '30 ימים' }).getAttribute('href')).toBe('/dashboard?range=30')
  })

  it('a failed query renders the explicit error card', async () => {
    render(await AnalyticsOverview({ stats: Promise.resolve(null) }))
    expect(screen.getByText('לא ניתן לטעון את נתוני הביצועים כרגע')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'טען נתונים מחדש' })).toBeTruthy()
  })
})

describe('FunnelCard', () => {
  it('shows the four stages, the close rate and lost outside the funnel', async () => {
    render(await FunnelCard({ stats: Promise.resolve(stats()) }))
    expect(screen.getByText('שיעור סגירה 33%')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('אבודים: 2')).toBeTruthy()
  })

  it('renders nothing without leads or on error', async () => {
    const empty = stats({ funnel: stats().funnel.map((s) => ({ ...s, count: 0 })) })
    const { container } = render(<>{await FunnelCard({ stats: Promise.resolve(empty) })}</>)
    expect(container.textContent).toBe('')
    expect(await FunnelCard({ stats: Promise.resolve(null) })).toBeNull()
  })
})

describe('LeadsTrendChart', () => {
  const points = [
    { newLeads: 4, replied: 2, short: '27.10', long: 'יום ג׳ · 27.10' },
    { newLeads: 6, replied: 3, short: '28.10', long: 'יום ד׳ · 28.10' },
  ]

  it('keyboard focus shows the tooltip for the latest day; arrows move between days', () => {
    render(<LeadsTrendChart points={points} />)
    const chart = screen.getByRole('group')
    fireEvent.focus(chart)
    expect(screen.getByRole('status').textContent).toContain('יום ד׳ · 28.10')
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(screen.getByRole('status').textContent).toContain('4 לידים חדשים')
    fireEvent.blur(chart)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
