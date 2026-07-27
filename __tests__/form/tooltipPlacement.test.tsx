// @vitest-environment jsdom
//
// [data-tip] tooltip placement opt-in. The default tooltip opens upward (CSS
// [data-tip]::before). Controls near the top of the page — where upward is
// clipped by main's overflow — opt into the downward variant via tooltipPos.
// These tests lock the contract: 'bottom' emits data-tip-pos='bottom'; default
// and 'top' emit nothing (existing tooltips are byte-for-byte unchanged); and
// ShowColumns opts in while its tooltip content stays the selected columns.
//
// Pure client, no DB: run with VITEST_NO_DB=1.

import { afterEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

import { Input, FormField } from '@/lib/form'
import ShowColumns from '@/lib/table/ShowColumns'

afterEach(cleanup)

describe('tooltip placement — [data-tip-pos] opt-in (default preserved)', () => {
  it('Input WITHOUT tooltipPos → data-tip present, NO data-tip-pos (default upward unchanged)', () => {
    const { container } = render(<Input lbl='שם' tooltip='עזרה' />)
    const label = container.querySelector('[data-tip]') as HTMLElement
    expect(label).toBeTruthy()
    expect(label.getAttribute('data-tip')).toBe('עזרה')
    expect(label.hasAttribute('data-tip-pos')).toBe(false)
  })

  it("Input tooltipPos='top' → still NO attribute (only 'bottom' opts in; no accidental global flip)", () => {
    const { container } = render(<Input lbl='שם' tooltip='עזרה' tooltipPos='top' />)
    const label = container.querySelector('[data-tip]') as HTMLElement
    expect(label.hasAttribute('data-tip-pos')).toBe(false)
  })

  it("Input tooltipPos='bottom' → data-tip-pos='bottom', content unchanged", () => {
    const { container } = render(<Input lbl='שם' tooltip='עזרה' tooltipPos='bottom' />)
    const label = container.querySelector('[data-tip]') as HTMLElement
    expect(label.getAttribute('data-tip-pos')).toBe('bottom')
    expect(label.getAttribute('data-tip')).toBe('עזרה')
  })

  it('FormField <p> (no htmlFor) path also honors tooltipPos', () => {
    const { container } = render(
      <FormField lbl='שם' tooltip='עזרה' tooltipPos='bottom'>
        <span />
      </FormField>,
    )
    const p = container.querySelector('[data-tip]') as HTMLElement
    expect(p.tagName).toBe('P')
    expect(p.getAttribute('data-tip-pos')).toBe('bottom')
  })
})

describe('ShowColumns — visible-columns control opts into the downward tooltip', () => {
  const makeConfig = () => ({
    columns: [
      { key: 'a', label: 'עמודה א' },
      { key: 'b', label: 'עמודה ב', noShow: true },
    ],
    setColumns: vi.fn(),
  })

  it('label receives data-tip-pos="bottom" (fixes Leads/Clients/Deals/Tasks via the shared control)', () => {
    const { container } = render(<ShowColumns config={makeConfig()} />)
    const label = container.querySelector('[data-tip-pos="bottom"]') as HTMLElement
    expect(label).toBeTruthy()
  })

  it('selected-column tooltip content is unchanged (joined labels of shown columns)', () => {
    const { container } = render(<ShowColumns config={makeConfig()} />)
    const label = container.querySelector('[data-tip-pos="bottom"]') as HTMLElement
    // only column "a" is shown (b is noShow) → tooltip lists its label
    expect(label.getAttribute('data-tip')).toBe('עמודה א')
  })
})
