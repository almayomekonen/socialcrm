// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { expectStickyEdges } from './stickyActionsEdge'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { GLOBAL_CUSTOMER_DATA, NOW, globalEnv, resetGlobalEnv } from './globalTasksFilesEnv'
import { gSpies as S, resetGSpies } from './globalTasksFilesMocks'
import { findHebrewLeaks } from './leakScan'

/**
 * The global /tasks and /files pages in en / ar: key strings, region
 * direction (nothing declared for Hebrew), the portalled delete confirmation,
 * tab titles, hydration and a language switch. Behaviour:
 * globalTasksFilesBehaviour.test.tsx. Hebrew is pinned by
 * globalTasksFilesHebrewBaseline.
 */

vi.mock('next/navigation', async () => (await import('./globalTasksFilesMocks')).navigationModule())
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./globalTasksFilesEnv')).globalEnv.user }))
vi.mock('@/db/uiLocale', async () => {
  const { gSpies } = await import('./globalTasksFilesMocks')
  return { getUiLocalePrefs: async () => ({ userLocale: gSpies.prefs.userLocale, agencyLocale: null }) }
})
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('@/db/tasks', async () => (await import('./globalTasksFilesMocks')).tasksDbModule())
vi.mock('@/db/clients', () => ({ getLeadsByRep: async () => [] }))
vi.mock('@/db/filter', async () => (await import('./globalTasksFilesMocks')).filterModule())
vi.mock('@/db/files', async () => ({ getFiles: async () => (await import('./globalTasksFilesEnv')).globalEnv.files }))
vi.mock('@/actions/tasks', async () => (await import('./globalTasksFilesMocks')).tasksActionsModule())
vi.mock('@/actions/files', async () => (await import('./globalTasksFilesMocks')).filesActionsModule())
vi.mock('@/actions/clients', () => ({ searchContacts: async () => [] }))
vi.mock('@/actions/global', async () => {
  const { gSpies } = await import('./globalTasksFilesMocks')
  return { saveTblPref: (...a: unknown[]) => gSpies.saveTblPref(...a) }
})
vi.mock('@/lib/toast', async () => {
  const { gSpies } = await import('./globalTasksFilesMocks')
  return {
    ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
    toast: (...a: unknown[]) => gSpies.toasts.push(a),
    proToast: () => {},
  }
})

const { globalFilesPage, globalShell, globalTasksPage } = await import('./globalTasksFilesHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'he' | 'en' | 'ar'
const PAGES = { tasks: globalTasksPage, files: globalFilesPage }

async function tree(locale: Loc, page: keyof typeof PAGES, overrides: Partial<typeof globalEnv> = {}) {
  S.prefs.userLocale = locale
  Object.assign(globalEnv, overrides)
  return globalShell(locale, await PAGES[page]())
}

const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => {
  for (const p of parts) expect(text, p).toContain(p)
}
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const data = GLOBAL_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  resetGlobalEnv()
  resetGSpies()
})

describe('/tasks in en / ar', () => {
  test('English: chrome, stored statuses labelled, counts, headers', async () => {
    const { container } = render(await tree('en', 'tasks'))
    const text = textOf(container)
    has(text, 'New task', 'Filter', 'Reps', 'Status', 'Task', 'Lead', 'Rep', 'Due date', 'Last activity', 'In progress', 'Awaiting reply', 'Handling complete')
    has(text, '8 tasks', '7 active', '1 done', '1 overdue', 'Create a new task', 'Or choose a template')
    expect(container.querySelector('[aria-label="Clear filters"]')).not.toBeNull()
    expect(regionOf(container.firstElementChild)).toEqual(['en', 'ltr'])
    expect(findHebrewLeaks(container, data)).toEqual([])
  })

  test('Arabic: plural forms, RTL region, no Hebrew outside data', async () => {
    const { container } = render(await tree('ar', 'tasks'))
    has(textOf(container), 'مهمة جديدة', '8 مهام', '7 مهام نشطة', 'مهمة مكتملة واحدة', 'مهمة متأخرة واحدة', 'قيد المعالجة')
    expect(regionOf(container.firstElementChild)).toEqual(['ar', 'rtl'])
    expect(findHebrewLeaks(container, data)).toEqual([])
  })

  test('empty state; Hebrew declares nothing', async () => {
    const en = render(await tree('en', 'tasks', { tasks: [] }))
    has(textOf(en.container), 'No tasks yet')
    en.unmount()
    resetGlobalEnv()
    const he = render(await tree('he', 'tasks'))
    expect(he.container.querySelector('[lang]')).toBeNull()
    expect(he.container.querySelector('[dir]')).toBeNull()
    has(textOf(he.container), 'משימה חדשה', '8 משימות')
  })
})

describe('/files in en / ar', () => {
  test('chrome, headers, filters, empty; the delete confirmation declares the language', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { container } = render(await tree(locale, 'files'))
      const text = textOf(container)
      if (locale === 'en') has(text, 'Files', 'File type', 'Size', 'Lead', 'Document name', 'Uploaded by', 'Delete', 'Up to 1MB')
      else has(text, 'الملفات', 'نوع الملف', 'العميل المحتمل', 'حتى 1MB')
      expect(regionOf(container.firstElementChild)).toEqual([locale, locale === 'en' ? 'ltr' : 'rtl'])
      expect(findHebrewLeaks(container, data)).toEqual([])
      fireEvent.click(container.querySelector('tbody td.sticky button')!)
      const dlg = document.querySelector('[role="dialog"]')!
      expect(regionOf(dlg)).toEqual([locale, locale === 'en' ? 'ltr' : 'rtl'])
      has(textOf(dlg), locale === 'en' ? 'Delete the document חוזה_חתום.pdf?' : 'هل تريد حذف المستند חוזה_חתום.pdf؟')
      expect(findHebrewLeaks(dlg, data)).toEqual([])
      cleanup()
    }
    const empty = render(await tree('en', 'files', { files: [] }))
    has(textOf(empty.container), 'No files yet')
  })
})

describe('tab titles', () => {
  test('each page titles the tab in the interface language; Hebrew is the title it always had', async () => {
    const tasks = await import('@/app/(he)/(app)/tasks/page')
    const files = await import('@/app/(he)/(app)/files/page')
    S.prefs.userLocale = 'en'
    expect(await tasks.generateMetadata()).toEqual({ title: 'Tasks', description: 'All lead tasks' })
    expect(await files.generateMetadata()).toEqual({ title: 'Files' })
    S.prefs.userLocale = 'ar'
    expect((await tasks.generateMetadata()).title).toBe('المهام')
    expect((await files.generateMetadata()).title).toBe('الملفات')
    process.env.UI_LOCALE_ENABLED = ''
    expect(await tasks.generateMetadata()).toEqual({ title: 'משימות', description: 'כל משימות הלידים' })
    expect(await files.generateMetadata()).toEqual({ title: 'קבצים' })
    process.env.UI_LOCALE_ENABLED = '1'
  })
})

describe('language switch within one session', () => {
  test('the same table re-renders in the new language, nothing stored changes', async () => {
    const { default: TasksTable } = await import('@/components/tasks/TasksTable')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    const props = { data: globalEnv.tasks, users: [], filter: {}, user: globalEnv.user, fillHeight: true }
    const view = render(<I18nProvider locale='en'><TasksTable {...props} /></I18nProvider>)
    has(textOf(view.container), 'New task', 'In progress')
    view.rerender(<I18nProvider locale='ar'><TasksTable {...props} /></I18nProvider>)
    has(textOf(view.container), 'مهمة جديدة', 'قيد المعالجة')
    view.rerender(<I18nProvider locale='he'><TasksTable {...props} /></I18nProvider>)
    has(textOf(view.container), 'משימה חדשה', 'בטיפול')
    expect(S.saveTblPref).not.toHaveBeenCalled()
  })
})

describe('hydration — server and client agree in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, build] of [
      ['tasks', () => tree(locale, 'tasks')],
      ['tasks, empty', () => tree(locale, 'tasks', { tasks: [] })],
      ['files', () => tree(locale, 'files')],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const node = await build()
        const container = document.createElement('div')
        container.innerHTML = renderToString(node)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => {
          root = hydrateRoot(container, node, { onRecoverableError: (e) => errors.push(e) })
        })
        spy.mockRestore()
        expect(errors.map((e) => (Array.isArray(e) ? e.map(String).join(' ') : String(e)).slice(0, 400))).toEqual([])
        act(() => root!.unmount())
        container.remove()
      })
    }
  }
})

describe('the actions column pins to the end of the row (final UI audit)', () => {
  test('he / ar pinned left as before, en pinned right', async () => {
    const seen = {} as Record<'he' | 'en' | 'ar', HTMLElement>
    for (const l of ['he', 'en', 'ar'] as const) {
      const { container } = render(await tree(l, 'files'))
      seen[l] = container.cloneNode(true) as HTMLElement
      cleanup()
    }
    expectStickyEdges(seen)
  })
})
