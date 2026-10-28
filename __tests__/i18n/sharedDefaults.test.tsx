// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import ToastMsg, { toast } from '@/lib/toast'
import { Btn } from '@/lib/btns/Btn'

afterEach(cleanup)

// jsdom has no popover API.
HTMLElement.prototype.showPopover ??= function () {}
HTMLElement.prototype.hidePopover ??= function () {}

function SubmitForm() {
  return (
    <form>
      <Btn as='submit' />
    </form>
  )
}

describe('Btn submit default label', () => {
  test('Hebrew without a provider — the pre-i18n text', () => {
    render(<SubmitForm />)
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeTruthy()
  })

  test('translated inside a provider', () => {
    render(
      <I18nProvider locale='en'>
        <SubmitForm />
      </I18nProvider>,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  test('an explicit label always wins', () => {
    render(
      <I18nProvider locale='ar'>
        <form>
          <Btn as='submit' lbl='שמור שינויים' />
        </form>
      </I18nProvider>,
    )
    expect(screen.getByRole('button', { name: 'שמור שינויים' })).toBeTruthy()
  })
})

describe('toast defaults (container outside the provider)', () => {
  function shownText() {
    return document.getElementById('popMsg')?.textContent ?? ''
  }

  test('Hebrew defaults when no non-Hebrew provider is mounted', () => {
    render(<ToastMsg />)
    act(() => toast('success'))
    expect(shownText()).toContain('בוצע בהצלחה!')
  })

  test('an English provider supplies English defaults; unmounting restores Hebrew', () => {
    const { unmount } = render(
      <>
        <ToastMsg />
        <I18nProvider locale='en'>
          <span />
        </I18nProvider>
      </>,
    )
    act(() => toast('error'))
    expect(shownText()).toContain('Something went wrong')
    act(() => toast('success', 'Explicit message'))
    expect(shownText()).toContain('Explicit message')
    unmount()
    render(<ToastMsg />)
    act(() => toast('success'))
    expect(shownText()).toContain('בוצע בהצלחה!')
  })

  test('a Hebrew provider leaves the built-in defaults untouched', () => {
    render(
      <>
        <ToastMsg />
        <I18nProvider locale='he'>
          <span />
        </I18nProvider>
      </>,
    )
    act(() => toast('ban'))
    expect(shownText()).toContain('אינך מורשה')
  })
})
