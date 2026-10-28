// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'

afterEach(cleanup)

describe('findHebrewLeaks — the scanner itself', () => {
  test('reports a Hebrew literal in text', () => {
    const { container } = render(<p>Leads · לידים</p>)
    expect(findHebrewLeaks(container, [])).toEqual([{ where: 'text in <p>', text: 'Leads · לידים' }])
  })

  test('reports Hebrew in aria-label, title, placeholder and alt', () => {
    const { container } = render(
      <div>
        <button aria-label='סגור' />
        <span title='עזרה'>Help</span>
        <input placeholder='חיפוש' />
        <img alt='לוגו' />
      </div>,
    )
    expect(findHebrewLeaks(container, []).map((l) => l.where)).toEqual([
      'aria-label on <button>',
      'title on <span>',
      'placeholder on <input>',
      'alt on <img>',
    ])
  })

  test('allows only the exact listed data values', () => {
    const { container } = render(
      <p>
        Owner: דנה כהן <b>ד</b>
      </p>,
    )
    const allowed = [
      { text: 'דנה כהן', reason: 'customer-data' as const },
      { text: 'ד', reason: 'customer-data' as const },
    ]
    expect(findHebrewLeaks(container, allowed)).toEqual([])
  })

  test('an allowance does not hide other Hebrew in the same string', () => {
    const { container } = render(<p>Business default (עברית) — שמור</p>)
    expect(findHebrewLeaks(container, [{ text: 'עברית', reason: 'endonym' }])).toHaveLength(1)
  })

  test('records which allowances were used', () => {
    const { container } = render(<p>עברית</p>)
    const used = new Set<string>()
    findHebrewLeaks(container, [{ text: 'עברית', reason: 'endonym' }, { text: 'דנה', reason: 'customer-data' }], used)
    expect([...used]).toEqual(['עברית'])
  })
})
