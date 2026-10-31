// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { expectStickyEdges } from './stickyActionsEdge'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DRIVE_SUGGESTIONS, FILE_ROWS, NOW, TASK_DETAIL, TASK_STATUSES, resetTabsEnv, tabsEnv } from './leadTabsEnv'
import { tabsSpies as S, resetTabsSpies } from './leadTabsMocks'

/**
 * The lead tabs BEHAVE identically in every interface language: the codes and
 * stored values they send (task status, new task, file delete, Drive attach /
 * detach, document kind) do not depend on the labels; validation messages are
 * translated; every empty state keeps its call to action.
 */

vi.mock('next/navigation', async () => {
  const { tabsSpies } = await import('./leadTabsMocks')
  return {
    usePathname: () => '/clients/41/tasks',
    useRouter: () => ({ push: (to: string) => tabsSpies.pushes.push(to), replace: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(''),
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }
})
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
  const { tabsSpies } = await import('./leadTabsMocks')
  return {
    useDrivePicker: () => ({
      status: env.pickerStatus,
      openPicker: ({ onPicked }: { onPicked: (f: unknown[]) => void }) => onPicked(tabsSpies.picked),
    }),
  }
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
const LOCALES: Loc[] = ['he', 'en', 'ar']
const PAGES = { tasks: tasksPage, taskDetail: taskDetailPage, files: filesPage, billing: billingPage }

async function mount(locale: Loc, page: keyof typeof PAGES, overrides: Partial<typeof tabsEnv> = {}) {
  S.prefs.userLocale = locale
  Object.assign(tabsEnv, overrides)
  return render(await tabsShell(locale, await PAGES[page]()))
}

/** The same user-visible strings per language (validation and CTAs). */
const COPY = {
  he: {
    titleRequired: 'יש להזין כותרת למעקב',
    leadRequired: 'יש לבחור ליד',
    editTitle: 'יש להזין כותרת',
    note: 'יש להזין תוכן להערה',
    noFiles: 'יש להעלות קבצים',
    createTask: 'צור משימה חדשה',
    upload: 'העלה קבצים',
    createDoc: 'צור מסמך',
    attached: 'הקובץ צורף לליד',
    attachedMany: 'צורפו 2 קבצים',
  },
  en: {
    titleRequired: 'Enter a task title',
    leadRequired: 'Choose a lead',
    editTitle: 'Enter a title',
    note: 'Enter the note text',
    noFiles: 'Upload at least one file',
    createTask: 'Create task',
    upload: 'Upload files',
    createDoc: 'Create document',
    attached: 'File attached to the lead',
    attachedMany: '2 files attached',
  },
  ar: {
    titleRequired: 'أدخل عنوان المهمة',
    leadRequired: 'اختر عميلًا محتملًا',
    editTitle: 'أدخل العنوان',
    note: 'أدخل نص الملاحظة',
    noFiles: 'ارفع ملفًا واحدًا على الأقل',
    createTask: 'إنشاء مهمة',
    upload: 'رفع الملفات',
    createDoc: 'إنشاء مستند',
    attached: 'تم إرفاق الملف بالعميل المحتمل',
    attachedMany: 'تم إرفاق ملفين',
  },
}

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

describe.each(LOCALES)('%s', (locale) => {
  const c = COPY[locale]

  test('task detail: a status picked by its label saves the STORED value; title and note validation', async () => {
    const { container } = await mount(locale, 'taskDetail')
    const statusInput = container.querySelectorAll('input[role="combobox"]')[1] as HTMLInputElement
    fireEvent.focus(statusInput)
    fireEvent.change(statusInput, { target: { value: '' } })
    await act(async () => fireEvent.mouseDown(screen.getAllByRole('option')[2]))
    expect(S.updateFullTask.mock.calls.at(-1)?.[0]).toMatchObject({
      id: TASK_DETAIL.id,
      status: TASK_STATUSES[2],
      completed: false,
    })
    fireEvent.change(container.querySelector('#taskTitle')!, { target: { value: ' ' } })
    await act(async () => fireEvent.click(container.querySelector('#taskTitleForm button')!))
    expect(container.querySelector('#taskTitleForm .text-red-500')?.textContent).toBe(c.editTitle)
    await act(async () => fireEvent.click(container.querySelector('.pt-6 .flex.gap-2.justify-end button')!))
    expect(container.querySelector('.pt-6 .text-red-500')?.textContent).toBe(c.note)
  })

  test('tasks tab: the status filter matches stored values; add task sends the same arguments; validation translated', async () => {
    const { container } = await mount(locale, 'tasks')
    const statusInput = container.querySelector('input[role="combobox"]') as HTMLInputElement
    fireEvent.focus(statusInput)
    // The filter is module state shared across renders: clear the typed text to list every status.
    fireEvent.change(statusInput, { target: { value: '' } })
    await act(async () => fireEvent.mouseDown(screen.getAllByRole('option')[1]))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    const popover = container.querySelector('#chooseTaskTmplt')!
    await act(async () => fireEvent.click(popover.querySelectorAll('button')[0]))
    expect(popover.querySelector('.text-red-500')?.textContent).toBe(c.titleRequired)
    fireEvent.change(container.querySelector('#newTaskTitle')!, { target: { value: 'משימה' } })
    await act(async () => fireEvent.click(popover.querySelectorAll('button')[0]))
    expect(S.addTask.mock.calls).toEqual([['41', tabsEnv.user, 'משימה']])
    await act(async () => fireEvent.submit(popover.querySelector('form')!))
    expect(S.addTaskFromTmplt.mock.calls).toEqual([['41', '301']])
    expect(S.pushes).toEqual(['/clients/41/tasks/99', '/clients/41/tasks/98'])
  })

  test('add-task form without a lead context asks for a lead', async () => {
    const { default: AddTaskForm } = await import('@/components/tasks/addTaskForm/AddTaskForm')
    S.prefs.userLocale = locale
    const { container } = render(
      await tabsShell(
        locale,
        <AddTaskForm clientId={null as never} taskTmplts={[]} clients={[]} user={{ role: 'AGNT' }} translated />,
      ),
    )
    fireEvent.change(container.querySelector('#newTaskTitle')!, { target: { value: 'x' } })
    await act(async () => fireEvent.click(container.querySelectorAll('#chooseTaskTmplt button')[0]))
    expect(container.querySelector('#chooseTaskTmplt .text-red-500')?.textContent).toBe(c.leadRequired)
    expect(S.addTask).not.toHaveBeenCalled()
  })

  test('files tab: delete sends the file; an empty upload is refused in the interface language', async () => {
    const { container } = await mount(locale, 'files')
    fireEvent.click(container.querySelector('tbody td.sticky button')!)
    await act(async () =>
      fireEvent.click(
        document.querySelector('[role="dialog"] button.bg-destructive, [role="dialog"] .flex.justify-end button:last-child')!,
      ),
    )
    expect(S.deleteFile.mock.calls[0]?.[0]).toMatchObject({ id: FILE_ROWS[0].id, name: FILE_ROWS[0].name })
    fireEvent.submit(container.querySelector('#filePopover form')!)
    expect(document.querySelector('[role="dialog"] p')?.textContent).toBe(c.noFiles)
  })

  test('Drive: attach and detach send the same payload; picker toasts count files', async () => {
    const { container } = await mount(locale, 'files')
    await act(async () => fireEvent.click(container.querySelector('.border-dashed button')!))
    const s = DRIVE_SUGGESTIONS[0]
    expect(S.attachDriveFile.mock.calls).toEqual([
      [{ leadId: 41, driveFileId: s.driveFileId, name: s.name, mimeType: s.mimeType, webViewLink: s.webViewLink }],
    ])
    await act(async () =>
      fireEvent.click(
        container.querySelector(
          'section .grid.gap-1\\.5 button.bg-destructive, section .grid.gap-1\\.5 .shrink-0 button:last-child',
        )!,
      ),
    )
    expect(S.detachDriveFile.mock.calls).toEqual([[801]])
    expect(S.toasts.map((t) => t[1])).toContain(c.attached)
    cleanup()
    process.env.DRIVE_PICKER_ENABLED = 'true'
    const file = { driveFileId: 'p', name: 'x', mimeType: 'application/pdf', webViewLink: null }
    S.picked = [file, { ...file, driveFileId: 'q' }]
    const p = await mount(locale, 'files')
    fireEvent.click(p.container.querySelector('section header button')!)
    await act(async () => fireEvent.click(document.querySelector('[role="dialog"] .grid.gap-3 button')!))
    expect(S.toasts.at(-1)).toEqual(['success', c.attachedMany])
  })

  test('billing: choosing the enabled kind routes by its code; disabled kinds do nothing', async () => {
    const { container } = await mount(locale, 'billing')
    fireEvent.click(container.querySelector('.py-4 button')!)
    const rows = document.querySelectorAll('[role="dialog"] ul li')
    fireEvent.click(rows[4].firstElementChild!)
    fireEvent.click(rows[0].querySelector('button')!)
    expect(S.pushes).toEqual(['/clients/41/billing/new?kind=invoice_receipt'])
  })

  test('empty states keep their call to action', async () => {
    let r = await mount(locale, 'tasks', { tasks: [], taskTmplts: [] })
    expect(r.container.querySelector('[popovertarget="chooseTaskTmplt"]')?.textContent).toBe(c.createTask)
    cleanup()
    r = await mount(locale, 'files', { files: [], attachments: [], suggestions: [] })
    expect(r.container.querySelector('[popovertarget="filePopover"]')?.textContent).toBe(c.upload)
    cleanup()
    r = await mount(locale, 'billing', { invoices: [] })
    expect(r.container.querySelector('.py-4 button')?.textContent).toBe(c.createDoc)
  })
})

describe('the actions column pins to the end of the row (final UI audit)', () => {
  test('he / ar pinned left as before, en pinned right', async () => {
    const seen = {} as Record<'he' | 'en' | 'ar', HTMLElement>
    for (const l of ['he', 'en', 'ar'] as const) {
      const { container } = await mount(l, 'files')
      seen[l] = container.cloneNode(true) as HTMLElement
      cleanup()
    }
    expectStickyEdges(seen)
  })
})
