// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DRIVE_SUGGESTIONS, EXPIRED, INVOICES, NOW, resetTabsEnv, tabsEnv } from './leadTabsEnv'
import { billingPage, filesPage, tabsShell } from './leadTabsHarness'

/**
 * HEBREW BASELINE for the lead FILES tab (files table, upload form, Google
 * Drive section, attach dialog, picker) and the BILLING tab list (document
 * list, chips, empty states, document-kind picker), plus a JSON snapshot of
 * their label producers. Recorded BEFORE the Phase C lead-tabs package; the
 * invoice editor (billing/new, billing/[invoiceId]) is Phase E and not here.
 *
 * Real server pages, I/O mocked, no i18n provider. Normalized: `<!-- -->`
 * separators and `useId` values only.
 */

const H = vi.hoisted(() => ({
  toasts: [] as unknown[][],
  calls: [] as unknown[][],
  attachOk: true,
  picked: [] as unknown[],
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/41/files',
  useRouter: () => ({ push: (to: string) => H.calls.push(['push', to]), replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./leadTabsEnv')).tabsEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireUser: async () => (await import('./leadTabsEnv')).tabsEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/tasks', () => ({ getTasksByClientId: async () => [{ id: 2, title: 'שיחת המשך' }] }))
vi.mock('@/db/files', async () => ({ getFilesByClientId: async () => (await import('./leadTabsEnv')).tabsEnv.files }))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [12], gotPermUsers: [], allPermUsers: [] }) }))
vi.mock('@/config/db', async () => {
  const { tabsEnv: env } = await import('./leadTabsEnv')
  const q = { where: () => q, whereIn: () => q, first: async () => (env.leadFound ? { id: 41 } : undefined) }
  return { db: () => q }
})
vi.mock('@/db/billing/invoices', async () => ({ listInvoicesForLead: async () => (await import('./leadTabsEnv')).tabsEnv.invoices }))
vi.mock('@/actions/files', () => ({
  deleteFile: async (...a: unknown[]) => H.calls.push(['deleteFile', ...a]),
  addFilesToTask: async (...a: unknown[]) => H.calls.push(['addFilesToTask', ...a]),
  addFiles: async () => [],
  getPresigned: async () => [],
}))
vi.mock('@/actions/leadDriveFiles', async () => ({
  listLeadDriveAttachments: async () => (await import('./leadTabsEnv')).tabsEnv.attachments,
  attachDriveFile: async (input: unknown) => (H.calls.push(['attachDriveFile', input]), { ok: H.attachOk }),
  detachDriveFile: async (id: unknown) => (H.calls.push(['detachDriveFile', id]), { ok: H.attachOk }),
}))
vi.mock('@/actions/leadDriveFilesSearch', async () => ({
  fetchSuggestedDriveFiles: async () => (await import('./leadTabsEnv')).tabsEnv.suggestions,
  searchDriveForLead: async ({ query }: { query: string }) => (query === 'none' ? [] : (await import('./leadTabsEnv')).DRIVE_SUGGESTIONS),
}))
vi.mock('@/lib/integrations/google/picker/useDrivePicker', async () => {
  const { tabsEnv: env } = await import('./leadTabsEnv')
  return { useDrivePicker: () => ({ status: env.pickerStatus, openPicker: ({ onPicked }: { onPicked: (f: unknown[]) => void }) => onPicked(H.picked) }) }
})
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => H.toasts.push(args), proToast: () => {} }))

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const html = (el: Element | null) => (el ? normalizeIds(el.outerHTML) : 'ABSENT')
const set = (overrides: Partial<typeof tabsEnv>) => Object.assign(tabsEnv, overrides)
const dialog = () => html(document.querySelector('[role="dialog"]'))
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetTabsEnv()
  delete process.env.DRIVE_PICKER_ENABLED
  Object.assign(H, { attachOk: true, picked: [] })
  H.toasts.length = 0
  H.calls.length = 0
})

describe('Hebrew baseline — /clients/[clientId]/files (server HTML)', () => {
  test('populated: files of every type, task link, Drive attachments + suggestions', async () => {
    expect(renderToString(await tabsShell(null, await filesPage()))).toMatchSnapshot()
  })

  test('empty files and Drive; Picker enabled; expired subscription', async () => {
    const out: Record<string, string> = {}
    set({ files: [], attachments: [], suggestions: [] })
    out.empty = renderToString(await tabsShell(null, await filesPage()))
    process.env.DRIVE_PICKER_ENABLED = 'true'
    out.pickerEnabled = renderToString(await tabsShell(null, await filesPage()))
    delete process.env.DRIVE_PICKER_ENABLED
    out.expired = renderToString(await tabsShell(null, await filesPage(), EXPIRED))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — files tab interactions', () => {
  test('delete confirm, upload without files, upload failure, size filter', async () => {
    const { container } = render(await tabsShell(null, await filesPage()))
    const out: Record<string, unknown> = {}
    fireEvent.click(container.querySelector('tbody td.sticky button')!)
    out.deleteConfirm = dialog()
    await act(async () => fireEvent.click(screen.getByText('אישור')))
    fireEvent.submit(container.querySelector('#filePopover form')!)
    out.noFiles = dialog()
    fireEvent.click(screen.getByText('אישור'))
    await act(async () => fireEvent.change(container.querySelector('#filePopover input[type="file"]')!, { target: { files: [] } }))
    out.uploadFailed = dialog()
    out.calls = H.calls
    out.toasts = H.toasts
    expect(out).toMatchSnapshot()
  })

  test('Drive: attach / detach toasts (ok + failed), search dialog states, picker states', async () => {
    const out: Record<string, unknown> = {}
    const page = render(await tabsShell(null, await filesPage()))
    await act(async () => fireEvent.click(screen.getByText('צרף')))
    await act(async () => fireEvent.click(screen.getAllByText('הסר')[0]))
    H.attachOk = false
    await act(async () => fireEvent.click(screen.getByText('צרף')))
    await act(async () => fireEvent.click(screen.getAllByText('הסר')[0]))
    fireEvent.click(screen.getByText('צרף קובץ מ-Drive'))
    out.searchPrompt = dialog()
    fireEvent.change(document.querySelector('[role="dialog"] input')!, { target: { value: 'יוסי' } })
    out.searchLoading = dialog()
    await wait(350)
    out.searchResults = dialog()
    fireEvent.change(document.querySelector('[role="dialog"] input')!, { target: { value: 'none' } })
    await wait(350)
    out.searchNone = dialog()
    page.unmount()
    process.env.DRIVE_PICKER_ENABLED = 'true'
    for (const status of ['idle', 'loading', 'unconfigured', 'error'] as const) {
      set({ pickerStatus: status })
      const p = render(await tabsShell(null, await filesPage()))
      fireEvent.click(screen.getByText('צרף קובץ מ-Drive'))
      out[`picker:${status}`] = dialog()
      if (status === 'idle') out.repick = html(p.container.querySelector('section'))
      p.unmount()
    }
    out.toasts = H.toasts
    expect(out).toMatchSnapshot()
  })

  test('Drive picker attach (one, many, none) and re-pick (ok, failed) toasts', async () => {
    process.env.DRIVE_PICKER_ENABLED = 'true'
    const file = { driveFileId: 'p', name: 'x', mimeType: 'application/pdf', webViewLink: null }
    for (const [picked, ok] of [[[file], true], [[file, { ...file, driveFileId: 'q' }], true], [[file], false]] as const) {
      Object.assign(H, { picked, attachOk: ok })
      const p = render(await tabsShell(null, await filesPage()))
      fireEvent.click(screen.getByText('צרף קובץ מ-Drive'))
      await act(async () => fireEvent.click(document.querySelector('[role="dialog"] .grid.gap-3 button')!))
      p.unmount()
    }
    for (const ok of [true, false]) {
      Object.assign(H, { picked: [file], attachOk: ok })
      const p = render(await tabsShell(null, await filesPage()))
      await act(async () => fireEvent.click(screen.getAllByText('צרף מחדש')[0]))
      p.unmount()
    }
    expect(H.toasts).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /clients/[clientId]/billing (list)', () => {
  test('every document and fulfilment state; empty with and without permission; lead not found', async () => {
    const out: Record<string, string> = {}
    out.populated = renderToString(await tabsShell(null, await billingPage()))
    set({ invoices: [] })
    out.emptyCanCreate = renderToString(await tabsShell(null, await billingPage()))
    set({ user: { ...tabsEnv.user, role: 'EXT' } })
    out.emptyNoPermission = renderToString(await tabsShell(null, await billingPage()))
    set({ leadFound: false })
    out.notFound = await billingPage().then(() => 'RENDERED', (e: Error) => e.message)
    expect(out).toMatchSnapshot()
  })

  test('document-kind picker: open, choose the enabled kind, disabled kinds inert', async () => {
    const { container } = render(await tabsShell(null, await billingPage()))
    const out: Record<string, unknown> = {}
    fireEvent.click(container.querySelector('button')!)
    out.picker = dialog()
    fireEvent.click(screen.getByText('הצעת מחיר'))
    fireEvent.click(document.querySelector('[role="dialog"] ul button')!)
    out.calls = H.calls
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — tab label producers (default arguments)', () => {
  test('task statuses, file headers and sizes, document states, numbers and kinds', async () => {
    const { statusOptions } = await import('@/components/tasks/SelectTasksStatus')
    const { headers } = await import('@/components/files/ClientFilesTable')
    const { fileSizes } = await import('@/types/vars')
    const billing = await import('@/components/billing/funcs')
    const kinds = await import('@/lib/billing/documentKinds')
    const { formatDocumentIdentity } = await import('@/lib/billing/numbering')
    expect({
      taskStatuses: statusOptions,
      fileHeaders: headers,
      fileSizes,
      docStates: ['draft', 'issued', 'voided', 'replaced', 'weird'].map((s) => billing.docStateLabel(s as never)),
      fulfillStates: ['open', 'partial', 'paid', 'overdue', 'written_off', null, 'weird'].map((s) => billing.fulfillStateLabel(s as never)),
      invoiceNumbers: INVOICES.map((i) => billing.formatInvoiceNumber(i as never)),
      identity: formatDocumentIdentity({ documentNumber: 42, docState: 'issued', kind: 'invoice_receipt' }),
      kinds: kinds.DOCUMENT_KINDS.map((k) => [k.id, k.label, k.enabled]),
      kindLabels: ['invoice', 'invoice_receipt', null].map((k) => kinds.documentKindLabel(k as never)),
      suggestionDate: DRIVE_SUGGESTIONS[0].modifiedTime.slice(0, 10),
    }).toMatchSnapshot()
  })
})
