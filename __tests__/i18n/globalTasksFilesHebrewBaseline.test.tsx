// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { GLOBAL_FILES, NOW, globalEnv, resetGlobalEnv } from './globalTasksFilesEnv'
import { globalFilesPage, globalShell, globalTasksPage } from './globalTasksFilesHarness'

/**
 * HEBREW BASELINE for the GLOBAL /tasks and /files pages (desktop). Recorded
 * against the code BEFORE Phase E1; every Hebrew render must still match
 * byte-for-byte afterwards.
 *
 * The REAL server pages run here (async server components resolved in place,
 * `next/dynamic` awaited); only I/O (db, actions, toasts, navigation) is
 * mocked. Rendered with NO i18n provider, i.e. exactly what a Hebrew user
 * receives today.
 *
 * Normalized before comparing, and only these:
 *  · React's invisible `<!-- -->` text separators.
 *  · React `useId` values (tree shape, not text).
 */

const H = vi.hoisted(() => ({ toasts: [] as unknown[][], calls: [] as unknown[][] }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
  useRouter: () => ({ push: (to: string) => H.calls.push(['push', to]), replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => H.calls.push(['redirect', to]),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./globalTasksFilesEnv')).globalEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/tasks', async () => {
  const { globalEnv: env } = await import('./globalTasksFilesEnv')
  return {
    getTasks: async (_u: unknown, filter: unknown) => ((env.lastFilter = structuredClone(filter)), env.tasks),
    getTaskTmplts: async () => env.taskTmplts,
  }
})
vi.mock('@/db/clients', async () => ({ getLeadsByRep: async () => (await import('./globalTasksFilesEnv')).globalEnv.leadsByRep }))
vi.mock('@/db/filter', async () => {
  const { GOT_PERM_USERS, GAVE_PERM_USERS } = await import('./globalTasksFilesEnv')
  return { getPerms: async () => ({ gotPermIds: [7, 12], gotPermUsers: GOT_PERM_USERS, gavePermUsers: GAVE_PERM_USERS }) }
})
vi.mock('@/db/files', async () => ({ getFiles: async () => (await import('./globalTasksFilesEnv')).globalEnv.files }))
vi.mock('@/actions/tasks', () => ({
  addTask: async (...a: unknown[]) => (H.calls.push(['addTask', ...a]), 99),
  addTaskFromTmplt: async (...a: unknown[]) => (H.calls.push(['addTaskFromTmplt', ...a]), 98),
}))
vi.mock('@/actions/files', () => ({
  deleteFile: async (...a: unknown[]) => H.calls.push(['deleteFile', ...a]),
  addFilesToTask: async () => {},
  addFiles: async () => [],
  getPresigned: async () => [],
}))
vi.mock('@/actions/clients', () => ({ searchContacts: async () => [] }))
vi.mock('@/actions/global', () => ({ saveTblPref: async (...a: unknown[]) => H.calls.push(['saveTblPref', ...a]) }))
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => H.toasts.push(args), proToast: () => {} }))

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const html = (el: Element | null) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetGlobalEnv()
  H.toasts.length = 0
  H.calls.length = 0
  localStorage.clear()
})

describe('Hebrew baseline — /tasks (server HTML)', () => {
  test('populated: every stored status, overdue, done, no handler; filter bar, footer, add-task popover', async () => {
    expect(renderToString(await globalShell(null, await globalTasksPage()))).toMatchSnapshot()
  })

  test('filtered by status + rep from the URL; the filter the page queried with', async () => {
    const out: Record<string, unknown> = {}
    out.html = renderToString(await globalShell(null, await globalTasksPage({ status: 'בטיפול', userId: '13' })))
    out.filter = globalEnv.lastFilter
    await globalTasksPage()
    out.defaultFilter = globalEnv.lastFilter
    expect(out).toMatchSnapshot()
  })

  test('empty: no tasks, no templates', async () => {
    globalEnv.tasks = []
    globalEnv.taskTmplts = []
    expect(renderToString(await globalShell(null, await globalTasksPage()))).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /tasks interactions', () => {
  test('status + rep pickers, filter submit, actions select, columns, search', async () => {
    const { container } = render(await globalShell(null, await globalTasksPage()))
    const out: Record<string, unknown> = {}
    const [statusInput, repInput] = Array.from(container.querySelectorAll('input[role="combobox"]')) as HTMLInputElement[]
    fireEvent.focus(statusInput)
    out.statusOptions = html(container.querySelector('[role="listbox"]'))
    fireEvent.mouseDown(screen.getAllByRole('option')[1])
    fireEvent.blur(statusInput)
    fireEvent.focus(repInput)
    out.repOptions = html(container.querySelector('[role="listbox"]'))
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    out.filterForm = html(container.querySelector('form'))
    await act(async () => fireEvent.submit(container.querySelector('form')!))
    out.calls = H.calls
    out.actionsSelect = html(container.querySelectorAll('select')[0] ?? null)
    const search = container.querySelector('input:not([role])') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'חוזה' } })
    out.searched = html(container.querySelector('tbody'))
    out.footer = html(container.querySelector('.rounded-b-md'))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /files', () => {
  test('populated: every file type, task link, lead link, no lead, size; filters', async () => {
    expect(renderToString(await globalShell(null, await globalFilesPage()))).toMatchSnapshot()
  })

  test('empty', async () => {
    globalEnv.files = []
    expect(renderToString(await globalShell(null, await globalFilesPage()))).toMatchSnapshot()
  })

  test('filters (type, size, lead) and the delete confirmation; delete payload', async () => {
    const { container } = render(await globalShell(null, await globalFilesPage()))
    const out: Record<string, unknown> = {}
    const [typeSel, sizeSel, leadSel] = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[]
    out.selects = [typeSel, sizeSel, leadSel].map((s) => html(s))
    fireEvent.change(typeSel, { target: { value: 'pdf' } })
    out.byType = html(container.querySelector('tbody'))
    fireEvent.change(typeSel, { target: { value: '' } })
    fireEvent.change(sizeSel, { target: { value: String(1024 * 1024) } })
    out.bySize = html(container.querySelector('tbody'))
    fireEvent.change(sizeSel, { target: { value: '' } })
    fireEvent.change(leadSel, { target: { value: '42' } })
    out.byLead = html(container.querySelector('tbody'))
    fireEvent.change(leadSel, { target: { value: '' } })
    fireEvent.click(container.querySelector('tbody td.sticky button')!)
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
    out.confirm = html(dialog)
    const confirmBtn = Array.from(dialog!.querySelectorAll('button')).pop()!
    await act(async () => fireEvent.click(confirmBtn))
    out.calls = H.calls.map(([name, file]) => [name, (file as { id?: number })?.id])
    out.fixtureIds = GLOBAL_FILES.map((f) => f.id)
    expect(out).toMatchSnapshot()
  })
})
