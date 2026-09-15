// @vitest-environment jsdom
/**
 * What a business owner sees in a report with delivery (fixtures, not a live
 * account): the right boxes, honest labels, the comparison, and the drill-down.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/sum_sales/ads' }))

import AdsReportShell from '@/modules/adsReporting/components/AdsReportShell'
import AdsReportView from '@/modules/adsReporting/components/AdsReportView'
import { metricsOf } from '@/lib/facebook/ads/metrics'
import { rowResult } from '@/lib/facebook/ads/results'
import type { AdsReport } from '@/lib/facebook/ads/report'

const act = (type: string, value: number) => ({ action_type: type, value: String(value) })
const campaign = (id: string, name: string, objective: string, row: Record<string, unknown>, status = 'ACTIVE') => {
  const metrics = metricsOf(row)
  return { id, name, objective, status, metrics, result: rowResult(objective, metrics) }
}

const LEADS = campaign('111', 'Leads Sept', 'OUTCOME_LEADS', { spend: '600', impressions: '30000', reach: '15000', inline_link_clicks: '300', inline_link_click_ctr: '1', actions: [act('lead', 20)] })
const BRAND = campaign('222', 'Brand', 'OUTCOME_AWARENESS', { spend: '400', impressions: '20000', reach: '10000' }, 'PAUSED')

function report(over: Partial<AdsReport> = {}): AdsReport & { totals: NonNullable<AdsReport['totals']> } {
  return {
    period: { since: '2026-08-16', until: '2026-09-14' },
    totals: metricsOf({
      spend: '1000', impressions: '50000', reach: '22000', frequency: '2.27', clicks: '900', ctr: '1.8', cpc: '1.11', cpm: '20',
      inline_link_clicks: '300', inline_link_click_ctr: '0.6', cost_per_inline_link_click: '3.33', actions: [act('lead', 20)], attribution_setting: '7d_click,1d_view',
    }),
    previous: { period: { since: '2026-07-17', until: '2026-08-15' }, totals: metricsOf({ spend: '800', impressions: '40000', actions: [act('lead', 25)] }) },
    daily: [],
    campaigns: [LEADS, BRAND],
    statusesAvailable: true,
    reducedFields: false,
    ...over,
  } as AdsReport & { totals: NonNullable<AdsReport['totals']> }
}

const ACCOUNT = { name: 'Main', currency: 'ILS', timezone: 'Asia/Jerusalem' }

function renderView(props: { report?: ReturnType<typeof report>; breakdown?: Parameters<typeof AdsReportView>[0]['breakdown']; rendered?: Record<string, string> }) {
  return render(
    <AdsReportShell rendered={props.rendered ?? { account: 'act_1' }} renderedLabel='Main · 30 ימים אחרונים' controls={null}>
      <AdsReportView report={props.report ?? report()} breakdown={props.breakdown ?? null} account={ACCOUNT} />
    </AdsReportShell>,
  )
}

beforeEach(() => {
  nav.push.mockReset()
})
afterEach(cleanup)

const box = (title: string) =>
  screen.getAllByText(title, { selector: 'span' }).map((el) => el.closest('.num-box')).find(Boolean) as HTMLElement

describe('summary', () => {
  it('context: period, account timezone, currency, attribution and the comparison period', () => {
    renderView({})
    expect(screen.getByText('16.08.2026–14.09.2026')).toBeInTheDocument()
    expect(screen.getByText('Asia/Jerusalem')).toBeInTheDocument()
    expect(screen.getByText('ILS')).toBeInTheDocument()
    expect(screen.getByText('7 ימים מקליק או יום אחד מצפייה')).toBeInTheDocument()
    expect(screen.getByText('17.07.2026–15.08.2026')).toBeInTheDocument()
  })

  it('leads are labelled as Meta-attributed; cost per lead counts LEAD campaigns only (600 ÷ 20, not 1000 ÷ 20)', () => {
    renderView({})
    const leads = box('לידים (לפי Meta)')
    expect(within(leads).getByRole('heading')).toHaveTextContent('20')
    expect(leads.textContent).toMatch(/עלות לליד בקמפייני לידים: \D*30\.00\D*₪/)
    expect(leads.textContent).toContain('−20% לעומת התקופה הקודמת')
    expect(screen.getByText(/לא לידים או מכירות\s+שאומתו ב-SocialCRM/)).toBeInTheDocument()
  })

  it('no purchase box when the account neither buys nor runs sales campaigns — never an always-empty box', () => {
    renderView({})
    expect(screen.queryByText('רכישות (לפי Meta)')).not.toBeInTheDocument()
  })

  it('purchases show Meta’s value and ROAS over the whole spend when present', () => {
    const totals = metricsOf({ spend: '500', impressions: '10000', actions: [act('omni_purchase', 5)], action_values: [act('omni_purchase', 2000)] })
    renderView({ report: report({ totals, previous: null, campaigns: [] }) })
    expect(box('רכישות (לפי Meta)').textContent).toMatch(/ROAS\): 4x/)
  })

  it('link clicks and all clicks are separate, and all-clicks rates sit under "מדדים נוספים"', () => {
    renderView({})
    expect(box('קליקים על קישור').textContent).toMatch(/עלות לקליק על קישור/)
    expect(screen.getByText('מדדים נוספים')).toBeInTheDocument()
    expect(box('כל הקליקים')).toBeInTheDocument()
    expect(box('אחוז הקלקה (כל הקליקים)')).toBeInTheDocument()
  })

  it('a comparison that failed, or a period that includes today, is said once — no per-box changes', () => {
    renderView({ report: report({ previous: 'unavailable' }) })
    expect(screen.getByText('ההשוואה לתקופה הקודמת לא נטענה')).toBeInTheDocument()
    expect(screen.queryByText(/לעומת התקופה הקודמת/)).not.toBeInTheDocument()
    cleanup()
    renderView({ report: report({ previous: 'partial' }) })
    expect(screen.getByText('לא מוצגת — התקופה כוללת את היום, שעדיין לא הסתיים')).toBeInTheDocument()
    expect(screen.queryByText(/לעומת התקופה הקודמת|אין נתון להשוואה/)).not.toBeInTheDocument()
  })

  it('previous period without delivery: said in the context line, not repeated in every box', () => {
    renderView({ report: report({ previous: { period: { since: '2026-07-17', until: '2026-08-15' }, totals: null } }) })
    expect(screen.getByText(/לא הייתה פעילות בתקופה הזו/)).toBeInTheDocument()
    expect(screen.queryByText('אין נתון להשוואה')).not.toBeInTheDocument()
  })

  it('a metric Meta did not return for the previous period shows no invented change; a previous 0 is said as 0', () => {
    renderView({ report: report({ previous: { period: { since: '2026-07-17', until: '2026-08-15' }, totals: metricsOf({ spend: '800', impressions: '40000', inline_link_clicks: '0' }) } }) })
    expect(box('אנשים שנחשפו').textContent).toContain('אין נתון להשוואה')
    expect(box('קליקים על קישור').textContent).toContain('0 בתקופה הקודמת')
  })

  it('a report on Meta’s basic fields says so', () => {
    renderView({ report: report({ reducedFields: true }) })
    expect(screen.getByText(/מוצגים המדדים הבסיסיים/)).toBeInTheDocument()
  })

  it('a Leads campaign converting in WhatsApp/Messenger counts conversations and stays out of cost per lead', () => {
    const whatsapp = campaign('333', 'WhatsApp leads', 'OUTCOME_LEADS', {
      spend: '400', impressions: '9000', actions: [act('onsite_conversion.messaging_conversation_started_7d', 16)],
    })
    renderView({ report: report({ campaigns: [LEADS, whatsapp, BRAND] }) })
    expect((screen.getByText('WhatsApp leads').closest('tr') as HTMLElement).textContent).toMatch(/16\s*שיחות שהתחילו/)
    expect(box('לידים (לפי Meta)').textContent).toMatch(/עלות לליד בקמפייני לידים: \D*30\.00\D*₪/)
  })
})

describe('campaigns and drill-down', () => {
  it('each campaign shows its own objective result, status, and a drill-down to its ad sets', () => {
    renderView({})
    const leadsRow = screen.getByText('Leads Sept').closest('tr') as HTMLElement
    expect(leadsRow.textContent).toContain('מטרה: לידים · פעיל')
    expect(leadsRow.textContent).toMatch(/20\s*לידים/)
    const brandRow = screen.getByText('Brand').closest('tr') as HTMLElement
    expect(brandRow.textContent).toMatch(/אנשים שנחשפו/)
    expect(brandRow.textContent).toContain('/ 1,000')

    fireEvent.click(within(leadsRow).getByRole('button', { name: 'קבוצות מודעות: Leads Sept' }))
    expect(nav.push).toHaveBeenCalledWith('/sum_sales/ads?account=act_1&campaign=111', { scroll: false })
  })

  it('delivery status that did not load, or that Meta did not report, is said — not guessed', () => {
    renderView({ report: report({ statusesAvailable: false, campaigns: [{ ...LEADS, status: null }] }) })
    expect((screen.getByText('Leads Sept').closest('tr') as HTMLElement).textContent).toContain('הסטטוס לא נטען')
    cleanup()
    renderView({ report: report({ campaigns: [{ ...LEADS, status: null }] }) })
    expect((screen.getByText('Leads Sept').closest('tr') as HTMLElement).textContent).toContain('סטטוס לא ידוע')
  })

  it('ad sets: breadcrumb back to all campaigns, ad set rows drill to ads', () => {
    renderView({
      rendered: { account: 'act_1', campaign: '111' },
      breakdown: {
        ok: true,
        value: { level: 'adset', campaign: { id: '111', name: 'Leads Sept' }, adset: null, statusesAvailable: true, rows: [{ ...LEADS, id: '501', name: 'Tel Aviv 25-45' }] },
      },
    })
    expect(screen.queryByText('ביצועים לפי קמפיין')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'מיקום בדוח' }).textContent).toContain('Leads Sept')
    fireEvent.click(screen.getByRole('button', { name: 'מודעות: Tel Aviv 25-45' }))
    expect(nav.push).toHaveBeenLastCalledWith('/sum_sales/ads?account=act_1&campaign=111&adset=501', { scroll: false })
    fireEvent.click(screen.getByRole('button', { name: 'כל הקמפיינים' }))
    expect(nav.push).toHaveBeenLastCalledWith('/sum_sales/ads?account=act_1', { scroll: false })
  })

  it('a failed drill-down is an error with retry and a way back — not an empty table', () => {
    renderView({ rendered: { account: 'act_1', campaign: '111' }, breakdown: { ok: false, reason: 'rate_limited' } })
    expect(screen.getByText('פייסבוק מגביל כרגע את קצב הבקשות')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }))
    expect(nav.refresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'חזרה לכל הקמפיינים' })).toBeInTheDocument()
  })
})

describe('daily trend', () => {
  it('behind a disclosure, per day, with leads when the account runs lead campaigns', () => {
    renderView({ report: report({ daily: [{ date: '2026-09-01', spend: 55.5, impressions: 1400, linkClicks: 20, leads: 3 }, { date: '2026-09-02', spend: 0, impressions: 0, linkClicks: 0, leads: 0 }] }) })
    expect(screen.getByText('מגמה יומית (2 ימים)')).toBeInTheDocument()
    expect(screen.getByText('לידים (לפי Meta)', { selector: 'th' })).toBeInTheDocument()
    expect(screen.getByText('01.09')).toBeInTheDocument()
  })

  it.each([
    ['too_long', 'המגמה היומית זמינה לטווחים של עד 92 ימים.'],
    ['unavailable', 'המגמה היומית לא נטענה מ-Meta. שאר הנתונים בדוח תקינים.'],
  ] as const)('%s → explained', (daily, text) => {
    renderView({ report: report({ daily }) })
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
