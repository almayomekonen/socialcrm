// @vitest-environment jsdom
/**
 * The promotions branch selector offers only generic branches.
 *
 * `משוקלל` — a weighted insurance premium — was prepended to this list for the
 * promotions form via `withCmsnBranch`, and it was the last insurance term an
 * administrator could still select anywhere in Settings.
 *
 * The removal has to keep one property that a plain deletion would break:
 * `Select` renders `defaultValue` through its options, so dropping the option
 * outright would blank the field on a promotion that already stores it and clear
 * the branch on the next save. These tests pin both halves — not offered for new
 * records, still present for a record that already carries it.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SelectPrdctOpts from '@/components/cmsnRules/SelectPrdctOpts'
import { BRANCHES } from '@/types/lists'

const LEGACY = 'משוקלל'

/** Option values of the ענף select, in order. */
function branchOptionValues(): string[] {
  const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement
  return Array.from(select.options)
    .map((o) => o.value)
    .filter(Boolean)
}

describe('a new promotion condition', () => {
  it('cannot select the legacy insurance branch', () => {
    render(<SelectPrdctOpts prdct={{}} />)
    expect(branchOptionValues()).not.toContain(LEGACY)
  })

  it('still offers every generic branch', () => {
    render(<SelectPrdctOpts prdct={{}} />)
    const values = branchOptionValues()
    for (const b of BRANCHES) expect(values).toContain(b)
  })

  it('offers exactly the generic branch list and nothing more', () => {
    render(<SelectPrdctOpts prdct={{}} />)
    expect(branchOptionValues()).toEqual([...BRANCHES])
  })

  it('is unaffected when the stored branch is already generic', () => {
    render(<SelectPrdctOpts prdct={{ branch: 'שירותים' }} />)
    expect(branchOptionValues()).toEqual([...BRANCHES])
    expect(branchOptionValues()).not.toContain(LEGACY)
  })
})

describe('a historical promotion that already stores the legacy branch', () => {
  it('keeps its value selectable so the record stays readable', () => {
    render(<SelectPrdctOpts prdct={{ branch: LEGACY }} />)
    expect(branchOptionValues()).toContain(LEGACY)
  })

  it('does not lose the value — the select still resolves it', () => {
    render(<SelectPrdctOpts prdct={{ branch: LEGACY }} />)
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    expect(select.value).toBe(LEGACY)
  })

  it('still offers the generic branches alongside it', () => {
    render(<SelectPrdctOpts prdct={{ branch: LEGACY }} />)
    const values = branchOptionValues()
    for (const b of BRANCHES) expect(values).toContain(b)
  })
})

describe('the rest of the product configuration is untouched', () => {
  it('still renders the product, product-type and company selectors', () => {
    render(<SelectPrdctOpts prdct={{ branch: 'שירותים' }} />)
    // ענף + מוצר + סוג מוצר + חברה
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('ענף')).toBeTruthy()
    expect(screen.getByText('מוצר')).toBeTruthy()
    expect(screen.getByText('סוג מוצר')).toBeTruthy()
    expect(screen.getByText('חברה')).toBeTruthy()
  })
})
