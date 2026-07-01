// @vitest-environment jsdom
//
// Accessibility regression suite for the ModalPop dialog primitive.
//
// Every dialog in the app is built on ModalPop, so these guarantees are
// load-bearing for keyboard and screen-reader users. The assertions query the
// COMPUTED accessibility tree — `getByRole('dialog', { name })` uses
// dom-accessibility-api, the same accessible-name algorithm a screen reader
// applies — so a regression here means a real regression for assistive tech.
//
// Guarantees locked in (do not weaken without an accessibility review):
//   1. The dialog receives focus when it opens.
//   2. The accessible name is computed correctly from BOTH `label` and `labelledBy`.
//   3. Focus returns to the triggering element when the dialog closes.
//   4. An unnamed dialog falls back ONLY to the defensive generic default.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'

const GENERIC_FALLBACK = 'תיבת דו-שיח'

afterEach(cleanup)

describe('ModalPop accessibility guarantees', () => {
  test('1. dialog receives focus on open', () => {
    render(
      <ModalPop open label='פרטי ליד' onClose={() => {}}>
        <button>שמור</button>
      </ModalPop>,
    )
    const dialog = screen.getByRole('dialog')
    // ModalPop focuses the dialog container itself when no child autofocuses.
    expect(document.activeElement).toBe(dialog)
  })

  test('1b. an autofocused child keeps focus (ModalPop does not steal it)', () => {
    render(
      <ModalPop open label='פרטי ליד' onClose={() => {}}>
        <input aria-label='כותרת' autoFocus />
      </ModalPop>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('כותרת'))
  })

  test('2a. accessible name is computed from `label`', () => {
    render(
      <ModalPop open label='פרטי ליד' onClose={() => {}}>
        <button>שמור</button>
      </ModalPop>,
    )
    expect(screen.getByRole('dialog', { name: 'פרטי ליד' })).toBeTruthy()
  })

  test('2b. accessible name is computed from `labelledBy`', () => {
    render(
      <ModalPop open labelledBy='dlg-title' onClose={() => {}}>
        <h2 id='dlg-title'>פרטי הפגישה</h2>
      </ModalPop>,
    )
    expect(screen.getByRole('dialog', { name: 'פרטי הפגישה' })).toBeTruthy()
  })

  test('3. focus returns to the trigger on close', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button data-testid='trigger'>open</button>
          <ModalPop open={open} label='פרטי ליד' onClose={() => {}}>
            <button>a</button>
          </ModalPop>
        </>
      )
    }
    const { rerender } = render(<Harness open={false} />)
    const trigger = screen.getByTestId('trigger')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    rerender(<Harness open={true} />)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    rerender(<Harness open={false} />)
    expect(document.activeElement).toBe(trigger)
  })

  test('4a. a named dialog does NOT fall back to the generic default', () => {
    render(
      <ModalPop open label='שליחת חשבונית' onClose={() => {}}>
        <button>שלח</button>
      </ModalPop>,
    )
    expect(screen.queryByRole('dialog', { name: GENERIC_FALLBACK })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'שליחת חשבונית' })).toBeTruthy()
  })

  test('4b. an unnamed dialog falls back ONLY to the defensive default', () => {
    render(
      <ModalPop open onClose={() => {}}>
        <p>content</p>
      </ModalPop>,
    )
    expect(screen.getByRole('dialog', { name: GENERIC_FALLBACK })).toBeTruthy()
  })

  test('Escape closes the dialog', () => {
    const onClose = vi.fn()
    render(
      <ModalPop open label='x' onClose={onClose}>
        <button>a</button>
      </ModalPop>,
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('real consumer', () => {
  test('ConfirmPop announces its message as the dialog name (label family)', () => {
    render(<ConfirmPop open msg='בטוח למחוק את הצוות?' onClose={() => {}} onConfirm={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'בטוח למחוק את הצוות?' })
    expect(dialog).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: GENERIC_FALLBACK })).toBeNull()
    expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true)
  })
})
