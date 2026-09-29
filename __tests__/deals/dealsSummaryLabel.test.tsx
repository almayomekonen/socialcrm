// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DashboardSummary, { revenueLabel } from '@/components/dashboard/DashboardSummary'

describe('deals summary revenue label', () => {
  it('says "this month" only when the active period really is the current month', () => {
    expect(revenueLabel({ dateRange: 'החודש הנוכחי' })).toBe('הכנסות החודש')
    expect(revenueLabel({ dateRange: 'החודש הנוכחי', saleDtRange: 'כל התאריכים' })).toBe('הכנסות החודש')
  })

  it('is neutral for any other period, or when a closing-date range narrows it', () => {
    for (const f of [
      { dateRange: 'כל התאריכים' },
      { dateRange: 'החודש הקודם' },
      { dateRange: 'השנה הנוכחית' },
      { dateRange: 'מותאם אישית', start: '2025-12-01', end: '2025-12-31' },
      { dateRange: 'החודש הנוכחי', saleDtRange: 'החודש הקודם' },
      {},
      undefined,
    ]) {
      expect(revenueLabel(f as any)).toBe('סה"כ הכנסות')
    }
  })

  it('renders exactly the count and revenue it is given (no query of its own)', () => {
    render(<DashboardSummary count='82' revenue={67252} rawFilter={{ dateRange: 'כל התאריכים' }} />)
    expect(screen.getByText('סה"כ הכנסות')).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText(/67,252/)).toBeInTheDocument()
  })
})
