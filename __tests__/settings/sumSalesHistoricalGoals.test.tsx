// @vitest-environment jsdom
/**
 * Historical goals still render on ביצועים after user management stopped editing them.
 *
 * The cleanup removed the editor and the write path but deliberately kept the
 * `users.goals` column and `/sum_sales` untouched, so agencies that already have
 * targets keep seeing them. That is the whole reason no migration was written —
 * and it is only true if this still passes.
 *
 * `משוקלל` is the one key that ever matched: `getGoalsAndTotals` keys totals by
 * branch name, and `משוקלל` is the sole intersection with the legacy goal keys.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GoalsAndTotals from '@/components/sales/GoalsAndTotals'

const AGNT = { role: 'AGNT' }

/** Shape returned by getGoalsAndTotals: totals keyed by branch, goals by goal key. */
const HISTORICAL = {
  goals: { 'משוקלל': 120000 },
  monthly_totals: { 'משוקלל': 15000, 'שירותים': 4000 },
  yearly_totals: { 'משוקלל': 90000, 'שירותים': 20000 },
}

describe('ביצועים keeps rendering targets that already exist', () => {
  it('renders the goal columns for historical משוקלל data', () => {
    render(<GoalsAndTotals user={AGNT} data={HISTORICAL} />)
    expect(screen.getByText('יעד חודשי')).toBeTruthy()
    expect(screen.getByText('הגעה ליעד')).toBeTruthy()
    expect(screen.getByText('קצב שנתי')).toBeTruthy()
  })

  it('still lists the branch rows', () => {
    render(<GoalsAndTotals user={AGNT} data={HISTORICAL} />)
    expect(screen.getByText('משוקלל')).toBeTruthy()
    expect(screen.getByText('שירותים')).toBeTruthy()
  })

  it('renders totals with no goals at all — the state new agencies are now in', () => {
    render(
      <GoalsAndTotals
        user={AGNT}
        data={{ goals: {}, monthly_totals: { 'שירותים': 4000 }, yearly_totals: { 'שירותים': 20000 } }}
      />,
    )
    // The row survives on its total alone; the goal columns simply do not appear.
    expect(screen.getByText('שירותים')).toBeTruthy()
    expect(screen.queryByText('יעד חודשי')).toBeNull()
  })

  it('renders nothing when there is neither a total nor a goal', () => {
    const { container } = render(
      <GoalsAndTotals user={AGNT} data={{ goals: {}, monthly_totals: { 'שירותים': 0 }, yearly_totals: {} }} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
