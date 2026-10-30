// @vitest-environment jsdom
/**
 * Shared controls in en / ar (Phase E6): the Pro toast's chrome (pushed by the
 * desktop shell's Topbar only), `useAction`'s generic line (opt-in), the (app)
 * error boundary (content, region, hydration), the files tables' delete-button
 * names and the uploader's gallery / unavailable words. Hebrew output is pinned
 * by sharedControlsHebrewBaseline and the earlier phases' baselines.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/actions/auth', () => ({ logout: async () => {} }))
vi.mock('@/modules/inbox/awareness/AwarenessContext', () => ({ useAwarenessCount: () => null }))
vi.mock('@/components/notifications/NotificationBell', async (orig) => ({ ...(await orig<any>()), default: () => null }))
vi.mock('@/components/education/HelpTrigger', () => ({ default: () => null }))
vi.mock('@/actions/files', () => ({
  getUserImgs: async () => [{ id: 1, url: 'https://example.test/a.webp' }],
  addFiles: async () => [],
  getPresigned: async () => [],
}))

const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
// The module namespace: `proToast` is re-bound when the container mounts (a live binding).
const toastModule = await import('@/lib/toast')
const ToastMsg = toastModule.default
const proToast = (opts: Parameters<typeof toastModule.proToast>[0]) => toastModule.proToast(opts)
const { default: Topbar } = await import('@/lib/navs/Topbar')
const { useAction } = await import('@/lib/useAction')
const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
const { default: AppError } = await import('@/app/(app)/error')
const { UserProvider } = await import('@/lib/hooksNEvents')
const { default: FileUploader } = await import('@/components/files/FileUploader')
const { FileDisplay } = await import('@/components/files/funcs')

HTMLElement.prototype.showPopover ??= function () {}
HTMLElement.prototype.hidePopover ??= function () {}

afterEach(cleanup)

const USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }
const proBox = () => screen.getByTestId('pro-toast')

describe('the Pro toast', () => {
  test.each([
    ['en', 'Renew subscription', 'ltr'],
    ['ar', 'تجديد الاشتراك', 'rtl'],
  ] as const)('%s on the desktop shell: the default CTA and the region follow the interface', (locale, cta, dir) => {
    render(
      <>
        <ToastMsg />
        <I18nProvider locale={locale}>
          <Topbar user={USER} />
        </I18nProvider>
      </>,
    )
    act(() => proToast({ title: 'T', body: 'B', source: 'test' }))
    expect(proBox().getAttribute('lang')).toBe(locale)
    expect(proBox().getAttribute('dir')).toBe(dir)
    expect(screen.getByRole('link', { name: cta, hidden: true }).getAttribute('href')).toContain('source=test')
    // An explicit CTA still wins.
    act(() => proToast({ title: 'T', body: 'B', source: 'test', cta: 'Upgrade' }))
    expect(screen.getByRole('link', { name: 'Upgrade', hidden: true })).toBeTruthy()
  })

  test('without the desktop shell (the phone workspace) the chrome stays Hebrew, as before', () => {
    render(
      <>
        <ToastMsg />
        <I18nProvider locale='en'>
          <span />
        </I18nProvider>
      </>,
    )
    act(() => proToast({ title: 'T', body: 'B', source: 'test' }))
    expect(proBox().getAttribute('dir')).toBe('rtl')
    expect(proBox().hasAttribute('lang')).toBe(false)
    expect(screen.getByRole('link', { name: 'חידוש מנוי', hidden: true })).toBeTruthy()
  })

  test('leaving the desktop shell restores the Hebrew chrome; a Hebrew shell pushes nothing', () => {
    const { rerender } = render(
      <>
        <ToastMsg />
        <I18nProvider locale='en'>
          <Topbar user={USER} />
        </I18nProvider>
      </>,
    )
    rerender(
      <>
        <ToastMsg />
        <I18nProvider locale='he'>
          <Topbar user={USER} />
        </I18nProvider>
      </>,
    )
    act(() => proToast({ title: 'T', body: 'B', source: 'test' }))
    expect(proBox().hasAttribute('lang')).toBe(false)
    expect(screen.getByRole('link', { name: 'חידוש מנוי', hidden: true })).toBeTruthy()
  })
})

function ActionProbe({ translated }: { translated?: boolean }) {
  const { error, run } = useAction(translated === undefined ? undefined : { translated })
  return (
    <div>
      <button type='button' onClick={() => run(async () => Promise.reject(new Error('boom')))}>
        run
      </button>
      <output data-testid='error'>{error ?? ''}</output>
    </div>
  )
}

describe('useAction', () => {
  test.each([
    ['en', 'Something went wrong, please try again'],
    ['ar', 'حدث خطأ ما، حاول مرة أخرى'],
  ] as const)('%s: a translated caller gets the interface line; an untranslated one keeps Hebrew', async (locale, line) => {
    render(
      <I18nProvider locale={locale}>
        <ActionProbe translated />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe(line))
    cleanup()
    render(
      <I18nProvider locale={locale}>
        <ActionProbe />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('משהו השתבש, נסה שוב'))
  })

  test('access denied: the entitlement CODE in every language', async () => {
    for (const locale of ['he', 'en', 'ar'] as const) {
      render(
        <I18nProvider locale={locale}>
          <EntitlementProvider value={{ hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: null }}>
            <ActionProbe translated />
          </EntitlementProvider>
        </I18nProvider>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'run' }))
      await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('ENTITLEMENT_EXPIRED'))
      cleanup()
    }
  })
})

describe('(app) error boundary', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

  test.each([
    ['en', 'ltr', 'Try again', 'Back to leads'],
    ['ar', 'rtl', 'حاول مرة أخرى', 'العودة إلى العملاء المحتملين'],
  ] as const)('%s: translated, declares its region inside the Hebrew <main>, same actions', (locale, dir, retry, back) => {
    const spy = quiet()
    const reset = vi.fn()
    const { container } = render(
      <I18nProvider locale={locale}>
        <main lang='he' dir='rtl'>
          <AppError error={new Error('x')} reset={reset} />
        </main>
      </I18nProvider>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('lang')).toBe(locale)
    expect(alert.getAttribute('dir')).toBe(dir)
    expect(findHebrewLeaks(container, [])).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: retry }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: back }).getAttribute('href')).toBe('/leads')
    spy.mockRestore()
  })

  test.each(['he', 'en', 'ar'] as const)('%s: server HTML hydrates without a mismatch', async (locale) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const node = (
      <I18nProvider locale={locale}>
        <AppError error={new Error('x')} reset={() => {}} />
      </I18nProvider>
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(node)
    document.body.appendChild(container)
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => {
      if (String(a[0]).startsWith('[app-error]')) return
      errors.push(a)
    })
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, node, { onRecoverableError: (e) => errors.push(e) })
    })
    spy.mockRestore()
    act(() => root?.unmount())
    container.remove()
    expect(errors).toEqual([])
  })
})

describe('file chrome', () => {
  test.each([
    ['en', 'Choose from gallery', 'Cannot be displayed'],
    ['ar', 'الاختيار من المعرض', 'لا يمكن العرض'],
  ] as const)('%s: a translated uploader words the gallery button and an unreadable entry', async (locale, gallery, unavailable) => {
    render(
      <I18nProvider locale={locale}>
        <UserProvider user={{ id: 7 }}>
          <FileUploader type='image' translated onFilesChange={() => {}} initialFiles={['broken-entry']} />
        </UserProvider>
      </I18nProvider>,
    )
    expect(await screen.findByRole('button', { name: gallery })).toBeTruthy()
    expect(screen.getByText(unavailable)).toBeTruthy()
  })

  test('an untranslated uploader / FileDisplay keeps the Hebrew words under any interface', async () => {
    render(
      <I18nProvider locale='en'>
        <UserProvider user={{ id: 7 }}>
          <FileUploader type='image' onFilesChange={() => {}} />
          <FileDisplay files={['broken-entry']} />
        </UserProvider>
      </I18nProvider>,
    )
    expect(await screen.findByRole('button', { name: 'בחירה מגלריה' })).toBeTruthy()
    expect(screen.getByText('לא ניתן להציג')).toBeTruthy()
  })
})

describe('files tables: the icon-only delete button', () => {
  const FILE = { id: 1, name: 'הצעה.pdf', url: 'https://example.test/a.pdf', type: 'application/pdf', size: 10, clientId: 4, clientName: 'יוסי', taskId: null, createdAt: '2026-10-01T09:00:00Z' }

  test.each([
    ['en', 'Delete the document הצעה.pdf'],
    ['ar', 'حذف المستند הצעה.pdf'],
  ] as const)('%s: named in the interface language (the file name is data); opens the same confirmation', async (locale, name) => {
    const { default: FilesTable } = await import('@/components/files/FilesTable')
    render(
      <I18nProvider locale={locale}>
        <FilesTable data={[FILE]} tasks={[]} clients={[]} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name }))
    // The same confirmation the unnamed button opened (ConfirmPop, portalled).
    await waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('הצעה.pdf'))
  })

  test('Hebrew: no name is added (Hebrew markup unchanged)', async () => {
    const { default: FilesTable } = await import('@/components/files/FilesTable')
    const { container } = render(<FilesTable data={[FILE]} tasks={[]} clients={[]} />)
    const trash = [...container.querySelectorAll('td.sticky button')]
    expect(trash).toHaveLength(1)
    expect(trash[0].hasAttribute('aria-label')).toBe(false)
  })
})
