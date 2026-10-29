// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NOW, TASK_DETAIL, resetTabsEnv, tabsEnv } from './leadTabsEnv'
import { tabsShell, taskDetailPage, tasksPage } from './leadTabsHarness'

/**
 * HEBREW BASELINE for the lead TASKS tab: `/clients/[clientId]/tasks` and the
 * task detail `/clients/[clientId]/tasks/[taskId]`. Recorded against the code
 * BEFORE the Phase C lead-tabs package; every Hebrew render must still match
 * byte-for-byte afterwards. Files + billing: leadTabsFilesHebrewBaseline.
 *
 * The REAL server pages run here (async server components resolved in place,
 * `next/dynamic` awaited); only I/O (db, actions, toasts) is mocked. Rendered
 * with NO i18n provider, i.e. exactly what a Hebrew user receives today.
 *
 * Normalized before comparing, and only these:
 *  · React's invisible `<!-- -->` text separators.
 *  · React `useId` values (tree shape, not text).
 */

const H = vi.hoisted(() => ({ toasts: [] as unknown[][], calls: [] as unknown[][] }))

vi.mock('next/navigation', async () => {
  const { tabsEnv: env } = await import('./leadTabsEnv')
  return {
    usePathname: () => env.pathname,
    useRouter: () => ({ push: (to: string) => H.calls.push(['push', to]), replace: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(''),
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }
})
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./leadTabsEnv')).tabsEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/tasks', async () => {
  const { tabsEnv: env } = await import('./leadTabsEnv')
  return {
    getTasksTbl: async () => env.tasks,
    getTaskTmplts: async () => env.taskTmplts,
    getTaskById: async () => (env.taskDetail ? structuredClone(env.taskDetail) : undefined),
  }
})
vi.mock('@/db/clients', () => ({ getLeadsByRep: async () => [] }))
vi.mock('@/db/filter', async () => {
  const { PERM_USERS } = await import('./leadTabsEnv')
  return { getPerms: async () => ({ gotPermIds: [12, 13], gotPermUsers: PERM_USERS, allPermUsers: PERM_USERS }) }
})
vi.mock('@/actions/tasks', () => ({
  addTask: async (...a: unknown[]) => (H.calls.push(['addTask', ...a]), 99),
  addTaskFromTmplt: async (...a: unknown[]) => (H.calls.push(['addTaskFromTmplt', ...a]), 98),
  updateFullTask: async (...a: unknown[]) => H.calls.push(['updateFullTask', ...a]),
  updateFullTaskTmplt: async (...a: unknown[]) => H.calls.push(['updateFullTaskTmplt', ...a]),
  deleteTask: async (...a: unknown[]) => H.calls.push(['deleteTask', ...a]),
}))
vi.mock('@/actions/clients', () => ({ searchContacts: async () => [] }))
vi.mock('@/actions/global', () => ({ saveTblPref: async () => ({}) }))
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => H.toasts.push(args), proToast: () => {} }))

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const html = (el: Element | null) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}
const set = (overrides: Partial<typeof tabsEnv>) => Object.assign(tabsEnv, overrides)

beforeAll(() => {
  // jsdom has no Popover API; the tabs open their menus with it.
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetTabsEnv()
  H.toasts.length = 0
  H.calls.length = 0
  localStorage.clear()
})

describe('Hebrew baseline — /clients/[clientId]/tasks (server HTML)', () => {
  test('populated: every stored status, overdue, done, no handler; filters; add-task popover', async () => {
    expect(renderToString(await tabsShell(null, await tasksPage()))).toMatchSnapshot()
  })

  test('empty: no tasks, no templates', async () => {
    set({ tasks: [], taskTmplts: [] })
    expect(renderToString(await tabsShell(null, await tasksPage()))).toMatchSnapshot()
  })
})

describe('Hebrew baseline — tasks tab interactions', () => {
  test('status filter options, handler filter, filtered rows', async () => {
    const { container } = render(await tabsShell(null, await tasksPage()))
    const out: Record<string, string> = {}
    const statusInput = container.querySelector('input[role="combobox"]') as HTMLInputElement
    fireEvent.focus(statusInput)
    out.statusOptions = html(container.querySelector('[role="listbox"]'))
    fireEvent.mouseDown(screen.getAllByRole('option')[1])
    out.filteredByStatus = html(container.querySelector('tbody'))
    const handler = container.querySelector('select') as HTMLSelectElement
    out.handlerSelect = html(handler)
    // Reset the module-level filters so later renders start unfiltered.
    fireEvent.focus(statusInput)
    fireEvent.change(statusInput, { target: { value: '' } })
    expect(out).toMatchSnapshot()
  })

  test('add-task form: missing title, missing lead (no lead context), created from title and from template', async () => {
    const { default: AddTaskForm } = await import('@/components/tasks/addTaskForm/AddTaskForm')
    const out: Record<string, unknown> = {}
    const lead = render(await tabsShell(null, <AddTaskForm clientId='41' taskTmplts={[]} clients={[]} user={tabsEnv.user} />))
    await act(async () => fireEvent.click(screen.getByText('יצירת משימה חדשה', { selector: 'button *, button' })))
    out.missingTitle = html(lead.container.querySelector('#chooseTaskTmplt'))
    lead.unmount()
    const global = render(await tabsShell(null, <AddTaskForm clientId={null as never} taskTmplts={[{ id: 301, title: 'תבנית' }]} clients={[{ id: 41, details: 'יוסי לוי' }]} user={{ role: 'AGNT' }} />))
    fireEvent.change(global.container.querySelector('#newTaskTitle')!, { target: { value: 'משימה' } })
    await act(async () => fireEvent.click(global.container.querySelectorAll('#chooseTaskTmplt button')[0]))
    out.globalMissingLead = html(global.container.querySelector('#chooseTaskTmplt'))
    global.unmount()
    const ok = render(await tabsShell(null, <AddTaskForm clientId='41' taskTmplts={[{ id: 301, title: 'תבנית' }]} clients={[]} user={tabsEnv.user} />))
    fireEvent.change(ok.container.querySelector('#newTaskTitle')!, { target: { value: 'משימה חדשה' } })
    await act(async () => fireEvent.click(ok.container.querySelectorAll('#chooseTaskTmplt button')[0]))
    await act(async () => fireEvent.submit(ok.container.querySelector('#chooseTaskTmplt form')!))
    out.calls = H.calls
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /clients/[clientId]/tasks/[taskId]', () => {
  test('header + notes (with notes), not completed', async () => {
    expect(renderToString(await tabsShell(null, await taskDetailPage()))).toMatchSnapshot()
  })

  test('completed, no notes; task not found', async () => {
    const out: Record<string, string> = {}
    set({ taskDetail: { ...TASK_DETAIL, completed: true, notes: [] } })
    out.completedNoNotes = renderToString(await tabsShell(null, await taskDetailPage()))
    set({ taskDetail: { ...TASK_DETAIL, notes: null } })
    out.notesNull = renderToString(await tabsShell(null, await taskDetailPage()))
    set({ taskDetail: null })
    out.notFound = renderToString(await tabsShell(null, await taskDetailPage()))
    expect(out).toMatchSnapshot()
  })

  test('status change, handler options, title validation, complete toggle: toasts and payloads', async () => {
    const { container } = render(await tabsShell(null, await taskDetailPage()))
    const out: Record<string, unknown> = {}
    const [userInput, statusInput] = Array.from(container.querySelectorAll('input[role="combobox"]')) as HTMLInputElement[]
    fireEvent.focus(userInput)
    out.userOptions = html(container.querySelector('[role="listbox"]'))
    fireEvent.blur(userInput)
    fireEvent.focus(statusInput)
    out.statusOptionsSelected = html(container.querySelector('[role="listbox"]'))
    fireEvent.change(statusInput, { target: { value: '' } })
    out.statusOptions = html(container.querySelector('[role="listbox"]'))
    await act(async () => fireEvent.mouseDown(screen.getAllByRole('option')[2]))
    const title = container.querySelector('#taskTitle') as HTMLInputElement
    fireEvent.change(title, { target: { value: '  ' } })
    await act(async () => fireEvent.click(container.querySelector('#taskTitleForm button')!))
    out.titleError = html(container.querySelector('#taskTitleForm'))
    out.ctxMenu = html(container.querySelector('#taskCtxMenu'))
    await act(async () => fireEvent.click(screen.getByText('סמן כבוצע')))
    out.header = html(container.querySelector('.space-y-5'))
    out.toasts = H.toasts
    out.calls = H.calls.map(([name, payload]) => [name, name === 'push' ? payload : { status: (payload as { status?: string }).status, completed: (payload as { completed?: boolean }).completed }])
    expect(out).toMatchSnapshot()
  })

  test('notes: empty-note validation, add, edit mode via the context menu, delete label', async () => {
    const { container } = render(await tabsShell(null, await taskDetailPage()))
    const out: Record<string, unknown> = {}
    const notes = () => html(container.querySelector('.pt-6'))
    await act(async () => fireEvent.click(screen.getByText('הוסף עדכון')))
    out.emptyError = notes()
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'עדכון חדש' } })
    await act(async () => fireEvent.click(screen.getByText('הוסף עדכון')))
    out.added = notes()
    fireEvent.contextMenu(screen.getByText(TASK_DETAIL.notes[0].content))
    fireEvent.click(container.querySelector('#noteCtxMenu button')!)
    out.editing = notes()
    out.toasts = H.toasts
    expect(out).toMatchSnapshot()
  })
})
