// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EXPIRED, FILE_ROWS, NOW, TASK_ROWS, resetTabsEnv, tabsEnv } from './leadTabsEnv'
import { tabsSpies as S, resetTabsSpies } from './leadTabsMocks'
import { findHebrewLeaks } from './leakScan'

/**
 * The lead tabs (tasks, task detail, files + Drive, billing list) in en / ar:
 * key strings, region direction (nothing declared for Hebrew), portalled
 * dialogs, tab titles and hydration. Behaviour: leadTabsBehaviour.test.tsx.
 * Hebrew output is pinned by the two leadTabs*HebrewBaseline tests.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/41/tasks',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./leadTabsEnv')).tabsEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireUser: async () => (await import('./leadTabsEnv')).tabsEnv.user }))
vi.mock('@/db/uiLocale', async () => {
  const { tabsSpies } = await import('./leadTabsMocks')
  return { getUiLocalePrefs: async () => ({ userLocale: tabsSpies.prefs.userLocale, agencyLocale: null }) }
})
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('@/db/tasks', async () => {
  const { tabsEnv: env } = await import('./leadTabsEnv')
  return {
    getTasksTbl: async () => env.tasks,
    getTaskTmplts: async () => env.taskTmplts,
    getTaskById: async () => (env.taskDetail ? structuredClone(env.taskDetail) : undefined),
    getTasksByClientId: async () => [{ id: 2, title: 'שיחת המשך' }],
  }
})
vi.mock('@/db/clients', () => ({ getLeadsByRep: async () => [] }))
vi.mock('@/db/filter', async () => {
  const { PERM_USERS } = await import('./leadTabsEnv')
  return { getPerms: async () => ({ gotPermIds: [12, 13], gotPermUsers: PERM_USERS, allPermUsers: PERM_USERS }) }
})
vi.mock('@/db/files', async () => ({ getFilesByClientId: async () => (await import('./leadTabsEnv')).tabsEnv.files }))
vi.mock('@/config/db', async () => {
  const { tabsEnv: env } = await import('./leadTabsEnv')
  const q = { where: () => q, whereIn: () => q, first: async () => (env.leadFound ? { id: 41 } : undefined) }
  return { db: () => q }
})
vi.mock('@/db/billing/invoices', async () => ({
  listInvoicesForLead: async () => (await import('./leadTabsEnv')).tabsEnv.invoices,
}))
vi.mock('@/actions/tasks', async () => {
  const { tabsSpies } = await import('./leadTabsMocks')
  return {
    addTask: tabsSpies.addTask,
    addTaskFromTmplt: tabsSpies.addTaskFromTmplt,
    updateFullTask: tabsSpies.updateFullTask,
    updateFullTaskTmplt: async () => {},
    deleteTask: tabsSpies.deleteTask,
  }
})
vi.mock('@/actions/files', async () => {
  const { tabsSpies } = await import('./leadTabsMocks')
  return {
    deleteFile: tabsSpies.deleteFile,
    addFilesToTask: tabsSpies.addFilesToTask,
    addFiles: async () => [],
    getPresigned: async () => [],
  }
})
vi.mock('@/actions/clients', () => ({ searchContacts: async () => [] }))
vi.mock('@/actions/leadDriveFiles', async () => {
  const { tabsSpies } = await import('./leadTabsMocks')
  return {
    listLeadDriveAttachments: async () => (await import('./leadTabsEnv')).tabsEnv.attachments,
    attachDriveFile: tabsSpies.attachDriveFile,
    detachDriveFile: tabsSpies.detachDriveFile,
  }
})
vi.mock('@/actions/leadDriveFilesSearch', async () => ({
  fetchSuggestedDriveFiles: async () => (await import('./leadTabsEnv')).tabsEnv.suggestions,
  searchDriveForLead: async () => (await import('./leadTabsEnv')).DRIVE_SUGGESTIONS,
}))
vi.mock('@/lib/integrations/google/picker/useDrivePicker', async () => {
  const { tabsEnv: env } = await import('./leadTabsEnv')
  return { useDrivePicker: () => ({ status: env.pickerStatus, openPicker: () => {} }) }
})
vi.mock('@/lib/toast', async () => {
  const { tabsSpies } = await import('./leadTabsMocks')
  return {
    ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
    toast: (...a: unknown[]) => tabsSpies.toasts.push(a),
    proToast: () => {},
  }
})

const { billingPage, filesPage, tabsShell, taskDetailPage, tasksPage } = await import('./leadTabsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'he' | 'en' | 'ar'
const PAGES = { tasks: tasksPage, taskDetail: taskDetailPage, files: filesPage, billing: billingPage }
/** The element each page's root renders (its region). */
const ROOT = { tasks: ':scope > div', taskDetail: '.paper', files: '.grid.gap-4', billing: '.py-4' }

async function tree(
  locale: Loc,
  page: keyof typeof PAGES,
  overrides: Partial<typeof tabsEnv> = {},
  ent = undefined as typeof EXPIRED | undefined,
) {
  S.prefs.userLocale = locale
  Object.assign(tabsEnv, overrides)
  return tabsShell(locale, await PAGES[page](), ent)
}

const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => {
  for (const p of parts) expect(text, p).toContain(p)
}
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const dialog = () => document.querySelector('[role="dialog"]')!

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
  resetTabsEnv()
  resetTabsSpies()
  delete process.env.DRIVE_PICKER_ENABLED
})

describe('English and Arabic content', () => {
  test('tasks tab: headers, stored statuses labelled, filters, add-task popover; dates in BUSINESS_TZ', async () => {
    const en = textOf(render(await tree('en', 'tasks')).container)
    has(
      en,
      'Status',
      'Assigned to',
      'Create task',
      'Title',
      'Due date',
      'Last activity',
      'Awaiting reply',
      'Moved to another rep',
      'Handling complete',
    )
    has(
      en,
      'Create a new task',
      'Task title',
      'Or choose a template',
      'Create task from template',
      '10/30/2026',
      TASK_ROWS[1].title,
    )
    cleanup()
    const ar = textOf(render(await tree('ar', 'tasks')).container)
    has(ar, 'الحالة', 'المسؤول', 'إنشاء مهمة', 'تاريخ الاستحقاق', 'بانتظار الرد', 'عنوان المهمة', '30/10/2026')
  })

  test('task detail: header, notes, context menu; note dates', async () => {
    const en = textOf(render(await tree('en', 'taskDetail')).container)
    has(en, 'Mark as done', 'Notes', 'Add update', 'Edit', 'Delete', 'Title', 'Save')
    expect(screen.getAllByLabelText('Delete note')).toHaveLength(2)
    expect(document.querySelector('textarea')!.getAttribute('placeholder')).toBe('Add an update: what happened with the lead?')
    cleanup()
    const ar = textOf(
      render(await tree('ar', 'taskDetail', { taskDetail: { ...tabsEnv.taskDetail, completed: true } })).container,
    )
    has(ar, 'إلغاء التحديد', 'الملاحظات', 'إضافة تحديث')
  })

  test('files tab: table, filters, upload form, Drive section; export keeps the stored Hebrew headers', async () => {
    const en = textOf(render(await tree('en', 'files')).container)
    has(
      en,
      "Lead's files",
      'File type',
      'Up to 10MB',
      'Upload files',
      'Document name',
      'Task',
      'Uploaded by',
      'Delete',
      'Add new files',
      'Link to a task (optional):',
      'Add files',
    )
    has(
      en,
      'Attach a file from Drive',
      'Open',
      'Remove',
      'Suggested: found in Drive from the lead details',
      'Attach',
      '10/20/2026',
      FILE_ROWS[0].name,
    )
    cleanup()
    const ar = textOf(render(await tree('ar', 'files', { attachments: [], suggestions: [] })).container)
    has(ar, 'ملفات العميل المحتمل', 'رفع الملفات', 'لا توجد ملفات من Drive مرفقة بهذا العميل المحتمل.')
  })

  test('billing list: states and kinds by code, numbers and amounts as data, empty state keeps its CTA', async () => {
    const en = textOf(render(await tree('en', 'billing')).container)
    has(
      en,
      'Billing',
      'Create document',
      'Document',
      'Amount',
      'Due by',
      'Draft, no number',
      'Invoice #00042',
      'Invoice/receipt #00043',
    )
    has(
      en,
      'Draft',
      'Issued',
      'Voided',
      'Replaced',
      'Awaiting payment',
      'Partially paid',
      'Paid',
      'Overdue',
      'Written off',
      'Edit',
      'View',
      '2,000.5 ₪',
    )
    cleanup()
    const ar = textOf(render(await tree('ar', 'billing', { invoices: [] })).container)
    has(ar, 'الفوترة', 'إنشاء مستند', 'لا توجد فواتير لهذا العميل المحتمل', 'ابدأ بإصدار أول فاتورة')
  })
})

describe('regions: page roots and portalled dialogs declare the language; Hebrew declares nothing', () => {
  for (const page of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
    test(page, async () => {
      for (const [locale, expected] of [
        ['en', ['en', 'ltr']],
        ['ar', ['ar', 'rtl']],
        ['he', [null, null]],
      ] as const) {
        const { container } = render(await tree(locale, page))
        expect(regionOf(container.querySelector(ROOT[page])), `${page} ${locale}`).toEqual(expected)
        cleanup()
      }
    })
  }

  test('Drive attach dialog, document-kind picker and the delete confirmation are in the interface language', async () => {
    const allowed = FILE_ROWS.map((f) => ({ text: f.name, reason: 'customer-data' as const }))
    for (const [locale, expected] of [
      ['en', ['en', 'ltr']],
      ['ar', ['ar', 'rtl']],
      ['he', [null, null]],
    ] as const) {
      const files = render(await tree(locale, 'files'))
      fireEvent.click(files.container.querySelector('section button')!)
      expect(regionOf(dialog())).toEqual(expected)
      if (locale !== 'he') expect(findHebrewLeaks(dialog(), [])).toEqual([])
      cleanup()
      render(await tree(locale, 'files'))
      fireEvent.click(document.querySelector('tbody td.sticky button')!)
      expect(regionOf(dialog())).toEqual(expected)
      if (locale !== 'he') expect(findHebrewLeaks(dialog(), allowed.slice(0, 1))).toEqual([])
      cleanup()
      const billing = render(await tree(locale, 'billing'))
      fireEvent.click(billing.container.querySelector('button')!)
      expect(regionOf(dialog())).toEqual(expected)
      if (locale !== 'he') expect(findHebrewLeaks(dialog(), [])).toEqual([])
      cleanup()
    }
    S.prefs.userLocale = 'en'
    render(await tree('en', 'billing'))
    fireEvent.click(document.querySelector('.py-4 button')!)
    has(
      textOf(dialog()),
      'Which document do you want to issue?',
      'Invoice/receipt',
      'Proforma invoice',
      'Coming soon',
      'Not sure which type',
    )
  })

  test('expired: the uploader and Drive locks follow the interface language', async () => {
    const { container } = render(await tree('en', 'files', {}, EXPIRED))
    const locks = Array.from(container.querySelectorAll('[data-testid="subscription-expired-inline"]'))
    expect(locks.map(textOf)).toEqual([
      'Renew your subscription to attach files againRenew subscription',
      'Renew your subscription to upload files againRenew subscription',
      'Renew your subscription to upload files againRenew subscription',
    ])
    expect(locks.map(regionOf)).toEqual([
      ['en', 'ltr'],
      ['en', 'ltr'],
      ['en', 'ltr'],
    ])
  })
})

describe('tab titles', () => {
  test('each tab page titles the tab in the interface language; Hebrew is the lead title it always had', async () => {
    const pages = {
      tasks: await import('@/app/(he)/(app)/clients/[clientId]/tasks/page'),
      taskDetail: await import('@/app/(he)/(app)/clients/[clientId]/tasks/[taskId]/page'),
      files: await import('@/app/(he)/(app)/clients/[clientId]/files/page'),
      billing: await import('@/app/(he)/(app)/clients/[clientId]/billing/page'),
    }
    for (const [path, { generateMetadata }] of Object.entries(pages)) {
      S.prefs.userLocale = 'en'
      expect(await generateMetadata(), path).toEqual({ title: 'Lead details', description: 'All of the lead’s details' })
      S.prefs.userLocale = 'ar'
      expect((await generateMetadata()).title).toBe('بيانات العميل المحتمل')
      process.env.UI_LOCALE_ENABLED = ''
      expect((await generateMetadata()).title).toBe('נתוני ליד')
      process.env.UI_LOCALE_ENABLED = '1'
    }
  })
})

describe('hydration — server and client agree in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, build] of [
      ['tasks', () => tree(locale, 'tasks')],
      ['task detail', () => tree(locale, 'taskDetail')],
      ['files', () => tree(locale, 'files')],
      ['files, expired', () => tree(locale, 'files', {}, EXPIRED)],
      ['billing', () => tree(locale, 'billing')],
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
