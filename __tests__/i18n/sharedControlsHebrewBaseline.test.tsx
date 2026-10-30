// @vitest-environment jsdom
/**
 * Hebrew baseline for the shared controls Phase E6 touches, recorded on
 * UNMODIFIED code: the subscription ("Pro") toast chrome, the plain toast
 * defaults, `api()`'s failure toast and returned value, `useAction`'s generic
 * failure line (and its entitlement code), and the (app) error boundary.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ToastMsg, { proToast, toast } from '@/lib/toast'
import { api } from '@/lib/funcs'
import { useAction } from '@/lib/useAction'
import { EntitlementProvider } from '@/lib/entitlement/EntitlementContext'

vi.mock('@/actions/files', () => ({
  getUserImgs: async () => [{ id: 1, url: 'https://example.test/a.webp' }],
  addFiles: async () => [],
  getPresigned: async () => [],
}))

// jsdom has no popover API.
HTMLElement.prototype.showPopover ??= function () {}
HTMLElement.prototype.hidePopover ??= function () {}

afterEach(cleanup)

function toastHtml(): string {
  return document.getElementById('popMsg')?.outerHTML ?? '(no toast)'
}

describe('toasts', () => {
  test('the Pro toast — default call-to-action and a caller-supplied one', () => {
    render(<ToastMsg />)
    act(() => proToast({ title: 'הפעולה זמינה עם Pro', body: 'חידוש המנוי יחזיר את הגישה.', source: 'baseline' }))
    expect(toastHtml()).toMatchSnapshot('default cta')
    act(() => proToast({ title: 'כותרת', body: 'גוף', source: 'baseline', cta: 'שדרוג' }))
    expect(toastHtml()).toMatchSnapshot('explicit cta')
  })

  test('every plain toast kind without a message', () => {
    render(<ToastMsg />)
    const shown: Record<string, string> = {}
    for (const kind of ['success', 'error', 'loading', 'ban', 'message', 'pro'] as const) {
      act(() => toast(kind))
      shown[kind] = document.getElementById('popMsg')?.textContent ?? ''
    }
    expect(shown).toMatchSnapshot()
  })

  test('api(): the failure toast and the thrown message returned verbatim', async () => {
    render(<ToastMsg />)
    const failing = async () => {
      throw new Error('server said: לא נמצא')
    }
    let res: unknown
    await act(async () => {
      res = await api(failing, {})
    })
    expect(document.getElementById('popMsg')?.textContent).toMatchSnapshot('generic failure toast')
    expect(res).toEqual({ msg: 'server said: לא נמצא', err: true })
    await act(async () => {
      res = await api(failing, {}, undefined, 'השמירה נכשלה')
    })
    expect(document.getElementById('popMsg')?.textContent).toBe('השמירה נכשלה')
    expect(res).toEqual({ msg: 'השמירה נכשלה', err: true })
    await act(async () => {
      res = await api(async () => 'ok', {})
    })
    expect(document.getElementById('popMsg')?.textContent).toMatchSnapshot('generic success toast')
  })
})

function ActionProbe() {
  const { error, run, loading } = useAction()
  return (
    <div>
      <button
        type='button'
        onClick={() =>
          run(async () => {
            throw new Error('boom')
          })
        }
      >
        run
      </button>
      <output data-testid='error'>{error ?? ''}</output>
      <output data-testid='loading'>{String(loading)}</output>
    </div>
  )
}

describe('useAction', () => {
  test('a failed action — the generic line', async () => {
    render(<ActionProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).not.toBe(''))
    expect(screen.getByTestId('error').textContent).toMatchSnapshot()
  })

  test('a failed action while access is denied — the entitlement code', async () => {
    render(
      <EntitlementProvider value={{ hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: null }}>
        <ActionProbe />
      </EntitlementProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('ENTITLEMENT_EXPIRED'))
  })
})

describe('(app) error boundary', () => {
  test('the recovery screen', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { default: AppError } = await import('@/app/(app)/error')
    const reset = vi.fn()
    const { container } = render(<AppError error={Object.assign(new Error('x'), { digest: 'd1' })} reset={reset} />)
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.click(screen.getByRole('button', { name: 'נסה שנית' }))
    expect(reset).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

describe('file chrome shared with translated uploaders', () => {
  test('the gallery button and an unreadable file entry', async () => {
    const { UserProvider } = await import('@/lib/hooksNEvents')
    const { default: Glry } = await import('@/components/files/Glry')
    const { FileDisplay } = await import('@/components/files/funcs')
    const { container } = render(
      <UserProvider user={{ id: 7 }}>
        <Glry onSelect={() => {}} />
        <FileDisplay files={['broken-entry', { name: 'הצעה.pdf', url: 'https://example.test/a.pdf', type: 'application/pdf' }]} />
      </UserProvider>,
    )
    await waitFor(() => expect(container.querySelector('#galleryPop')).not.toBeNull())
    expect(container.innerHTML).toMatchSnapshot()
  })
})
