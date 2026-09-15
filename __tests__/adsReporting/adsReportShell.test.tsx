// @vitest-environment jsdom
/**
 * Loading feedback for the ad report.
 *
 * Changing the dates or the account is a server round-trip to Meta. The previous
 * report must stay on screen (no full-page spinner), be clearly marked as the
 * previous selection, and never be presented as current when an older, slower
 * response lands after a newer choice.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/sum_sales/ads',
}))

import AdsReportShell from '@/modules/adsReporting/components/AdsReportShell'
import AdsReportControls from '@/modules/adsReporting/components/AdsReportControls'
import { adsSelectionHref, adsSelectionKey, CLEAR_ADSET, CLEAR_DRILLDOWN, nextAdsSelection } from '@/lib/facebook/ads/selection'
import AdsReportSkeleton from '@/modules/adsReporting/components/AdsReportSkeleton'

const ACCOUNTS = [
  { id: 'act_1', name: 'Main' },
  { id: 'act_2', name: 'Second' },
]
const TODAY = '2026-09-15'

function Page({ rendered, label }: { rendered: Record<string, string>; label: string }) {
  return (
    <AdsReportShell rendered={rendered} renderedLabel={label} controls={<AdsReportControls accounts={ACCOUNTS} accountId={rendered.account ?? 'act_1'} today={TODAY} />}>
      <p>report for {label}</p>
    </AdsReportShell>
  )
}

beforeEach(() => {
  nav.push.mockReset()
  nav.replace.mockReset()
  nav.refresh.mockReset()
})
afterEach(cleanup)

describe('selection helpers', () => {
  it('builds one canonical key and href from the raw query, custom dates only with a custom range', () => {
    expect(adsSelectionKey({ range: 'last_7d', account: 'act_1', since: '2026-01-01' })).toBe('account=act_1&range=last_7d')
    expect(adsSelectionHref('/sum_sales/ads', { account: 'act_1', range: 'custom', since: '2026-09-01', until: '2026-09-10' })).toBe(
      '/sum_sales/ads?account=act_1&range=custom&since=2026-09-01&until=2026-09-10',
    )
  })

  it('drill-down exits survive the server→client prop boundary (undefined props are dropped there)', () => {
    const drilled = { account: 'act_1', range: 'last_30d', campaign: 'c1', adset: 's1' }
    const overTheWire = (v: object) => JSON.parse(JSON.stringify(v))
    expect(adsSelectionKey(nextAdsSelection(drilled, overTheWire(CLEAR_DRILLDOWN)))).toBe('account=act_1&range=last_30d')
    expect(adsSelectionKey(nextAdsSelection(drilled, overTheWire(CLEAR_ADSET)))).toBe('account=act_1&range=last_30d&campaign=c1')
    // The bug this pins: `undefined` does not survive, so it cannot be how an exit is expressed.
    expect(adsSelectionKey(nextAdsSelection(drilled, overTheWire({ campaign: undefined, adset: undefined })))).toBe(adsSelectionKey(drilled))
  })

  it('a new account or date range leaves the drill-down; a new campaign clears the ad set', () => {
    const drilled = { account: 'act_1', range: 'last_30d', campaign: 'c1', adset: 's1' }
    expect(nextAdsSelection(drilled, { range: 'last_7d' })).toEqual({ account: 'act_1', range: 'last_7d' })
    expect(nextAdsSelection(drilled, { account: 'act_2' })).toEqual({ account: 'act_2', range: 'last_30d' })
    expect(nextAdsSelection(drilled, { campaign: 'c2' })).toEqual({ account: 'act_1', range: 'last_30d', campaign: 'c2' })
    expect(nextAdsSelection(drilled, { adset: 's2' })).toEqual({ ...drilled, adset: 's2' })
  })
})

describe('first load', () => {
  it('the skeleton mirrors the report and announces loading once', () => {
    render(<AdsReportSkeleton />)
    expect(screen.getByTestId('ads-report-skeleton')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('טוען…')
  })
})

describe('refreshing an existing report', () => {
  const A = { account: 'act_1', range: 'last_30d' }

  it('keeps the previous report visible, dims it, and says whose numbers they are', () => {
    render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    expect(screen.getByTestId('ads-report-status')).toHaveTextContent('הבחירה: Main · 30 ימים אחרונים')

    fireEvent.change(screen.getByLabelText('טווח תאריכים'), { target: { value: 'last_7d' } })

    expect(nav.push).toHaveBeenCalledWith('/sum_sales/ads?account=act_1&range=last_7d', { scroll: false })
    expect(screen.getByRole('status')).toHaveTextContent('מעדכן נתונים…')
    expect(screen.getByRole('status')).toHaveTextContent('עד שהעדכון יסתיים מוצגת הבחירה הקודמת: Main · 30 ימים אחרונים')
    expect(screen.getByText('report for Main · 30 ימים אחרונים')).toBeInTheDocument()
    expect(screen.getByTestId('ads-report-body')).toHaveAttribute('aria-busy', 'true')
    // The control already shows the new choice.
    expect(screen.getByLabelText('טווח תאריכים')).toHaveValue('last_7d')
  })

  it('clears the update state once the newest selection is the one rendered', () => {
    const { rerender } = render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    fireEvent.change(screen.getByLabelText('טווח תאריכים'), { target: { value: 'last_7d' } })
    rerender(<Page rendered={{ account: 'act_1', range: 'last_7d' }} label='Main · 7 ימים אחרונים' />)
    expect(screen.queryByText('מעדכן נתונים…')).not.toBeInTheDocument()
    expect(screen.getByTestId('ads-report-body')).toHaveAttribute('aria-busy', 'false')
  })

  it('rapid changes: an older response landing after a newer choice is never shown as current', () => {
    const { rerender } = render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    fireEvent.change(screen.getByLabelText('טווח תאריכים'), { target: { value: 'last_7d' } })
    fireEvent.change(screen.getByLabelText('חשבון מודעות'), { target: { value: 'act_2' } })
    expect(nav.push).toHaveBeenLastCalledWith('/sum_sales/ads?account=act_2&range=last_7d', { scroll: false })

    // The first (older) request resolves last.
    rerender(<Page rendered={{ account: 'act_1', range: 'last_7d' }} label='Main · 7 ימים אחרונים' />)
    expect(screen.getByRole('status')).toHaveTextContent('מעדכן נתונים…')
    expect(screen.getByRole('status')).toHaveTextContent('מוצגת הבחירה הקודמת: Main · 7 ימים אחרונים')
    expect(screen.getByLabelText('חשבון מודעות')).toHaveValue('act_2')
    // Every navigation settled on the older selection → the newest is requested again, once.
    expect(nav.replace).toHaveBeenCalledTimes(1)
    expect(nav.replace).toHaveBeenCalledWith('/sum_sales/ads?account=act_2&range=last_7d', { scroll: false })
    rerender(<Page rendered={{ account: 'act_1', range: 'last_7d' }} label='Main · 7 ימים אחרונים' />)
    expect(nav.replace).toHaveBeenCalledTimes(1)

    rerender(<Page rendered={{ account: 'act_2', range: 'last_7d' }} label='Second · 7 ימים אחרונים' />)
    expect(screen.queryByText('מעדכן נתונים…')).not.toBeInTheDocument()
  })

  it('back/forward is the user choosing the older selection — accepted, not re-requested', () => {
    const { rerender } = render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    fireEvent.change(screen.getByLabelText('טווח תאריכים'), { target: { value: 'last_7d' } })
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    rerender(<Page rendered={{ account: 'act_1', range: 'this_month' }} label='Main · החודש' />)
    expect(nav.replace).not.toHaveBeenCalled()
    expect(screen.queryByText('מעדכן נתונים…')).not.toBeInTheDocument()
    expect(screen.getByLabelText('טווח תאריכים')).toHaveValue('this_month')
  })

  it('Back while an update is pending abandons it, even when history lands on the same selection', () => {
    render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    fireEvent.change(screen.getByLabelText('טווח תאריכים'), { target: { value: 'last_7d' } })
    expect(screen.getByRole('status')).toHaveTextContent('מעדכן נתונים…')
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.queryByText('מעדכן נתונים…')).not.toBeInTheDocument()
    expect(screen.getByLabelText('טווח תאריכים')).toHaveValue('last_30d')
  })

  it('an account the URL names but Meta does not list shows the account actually read', () => {
    render(
      <AdsReportShell rendered={{ account: 'act_999', range: 'last_30d' }} renderedLabel='Main · 30 ימים אחרונים' controls={<AdsReportControls accounts={ACCOUNTS} accountId='act_1' today={TODAY} />}>
        <p>report</p>
      </AdsReportShell>,
    )
    expect(screen.getByLabelText('חשבון מודעות')).toHaveValue('act_1')
  })

  it('exactly one live region announces the status', () => {
    render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    fireEvent.change(screen.getByLabelText('טווח תאריכים'), { target: { value: 'last_7d' } })
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0)
  })

  it('choosing what is already shown does nothing', () => {
    render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    fireEvent.change(screen.getByLabelText('חשבון מודעות'), { target: { value: 'act_1' } })
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('a custom range is sent only when both dates are valid', () => {
    render(<Page rendered={A} label='Main · 30 ימים אחרונים' />)
    fireEvent.change(screen.getByLabelText('טווח תאריכים'), { target: { value: 'custom' } })
    expect(nav.push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'הצג ביצועים' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('מתאריך'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('עד תאריך'), { target: { value: '2026-08-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'הצג ביצועים' }))
    expect(nav.push).toHaveBeenCalledWith('/sum_sales/ads?account=act_1&range=custom&since=2026-08-01&until=2026-08-31', {
      scroll: false,
    })
  })
})
