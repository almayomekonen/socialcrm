// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NOW, globalEnv, resetGlobalEnv } from './globalTasksFilesEnv'
import { gSpies as S, resetGSpies } from './globalTasksFilesMocks'

/**
 * Behaviour of the global /tasks and /files pages is the same in every
 * language: filters send the STORED status value, the column state saves the
 * stored Hebrew labels, the add-task form sends the same arguments and shows
 * its validation translated, file filters pick the same rows, a delete sends
 * the same file, Escape dismisses without deleting.
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
vi.mock('@/db/clients', async () => ({ getLeadsByRep: async () => (await import('./globalTasksFilesEnv')).globalEnv.leadsByRep }))
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
  return { ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')), toast: (...a: unknown[]) => gSpies.toasts.push(a), proToast: () => {} }
})

const { globalFilesPage, globalShell, globalTasksPage } = await import('./globalTasksFilesHarness')
const { headers } = await import('@/components/tasks/TasksTable')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LOCALES = ['he', 'en', 'ar'] as const
type Loc = (typeof LOCALES)[number]

async function page(locale: Loc, which: 'tasks' | 'files') {
  S.prefs.userLocale = locale
  return render(await globalShell(locale, await (which === 'tasks' ? globalTasksPage() : globalFilesPage())))
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
  resetGlobalEnv()
  resetGSpies()
})

describe('/tasks behaves the same in every language', () => {
  test('the filter form sends the stored status and rep id; the clear button is named', async () => {
    const sent: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      const { container } = await page(locale, 'tasks')
      const [statusInput, repInput] = Array.from(container.querySelectorAll('input[role="combobox"]')) as HTMLInputElement[]
      fireEvent.focus(statusInput)
      // The second stored status ('בטיפול'), whatever its label in this language.
      fireEvent.mouseDown(container.querySelectorAll('[role="listbox"] [role="option"]')[1])
      fireEvent.blur(statusInput)
      fireEvent.focus(repInput)
      fireEvent.change(repInput, { target: { value: '' } })
      const repList = container.querySelector('[role="listbox"]')!
      fireEvent.mouseDown(Array.from(repList.querySelectorAll('[role="option"]')).find((o) => o.textContent === 'רון נציג')!)
      await act(async () => fireEvent.submit(container.querySelector('form')!))
      sent[locale] = [...S.redirects]
      const clear = container.querySelector('a[aria-label]')!
      expect(clear.getAttribute('aria-label'), locale).toBe({ he: 'נקה חיפוש', en: 'Clear filters', ar: 'مسح عوامل التصفية' }[locale])
      cleanup()
      resetGSpies()
    }
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
    expect(sent.he).toEqual(['?filter={"status":"בטיפול","userId":"13"}'])
  })

  test('hiding a column saves the STORED Hebrew labels in every language', async () => {
    const saved: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      const { container } = await page(locale, 'tasks')
      // The columns picker: the toolbar's second free-text input (after the search box).
      const picker = container.querySelectorAll('input:not([type="hidden"]):not([role]):not([name])')[1] as HTMLInputElement
      fireEvent.focus(picker)
      const lastColumn = Array.from(picker.parentElement!.parentElement!.querySelectorAll('button[type="button"]')).pop()!
      await act(async () => fireEvent.mouseDown(lastColumn))
      saved[locale] = structuredClone(S.saveTblPref.mock.calls.at(-1))
      cleanup()
      resetGSpies()
      // Hebrew edits the stored column objects in place (the module's default
      // `headers` included — pre-existing); start every language from the same state.
      for (const h of headers as { noShow?: boolean }[]) delete h.noShow
    }
    expect(saved.en).toEqual(saved.he)
    expect(saved.ar).toEqual(saved.he)
    expect(JSON.stringify(saved.he)).toContain('תאריך פעילות אחרון')
  })

  test('add task (no lead context): validation translated, same arguments sent', async () => {
    const sent: Record<string, unknown> = {}
    const messages = { he: ['יש להזין כותרת למעקב', 'יש לבחור ליד'], en: ['Enter a task title', 'Choose a lead'], ar: [] as string[] }
    for (const locale of LOCALES) {
      Object.assign(globalEnv, { user: { ...globalEnv.user, role: 'AGNT' }, leadsByRep: [{ id: 41, details: 'יוסי לוי' }] })
      const { container } = await page(locale, 'tasks')
      const pop = container.querySelector('#chooseTaskTmplt')!
      const create = pop.querySelectorAll('button')
      await act(async () => fireEvent.click(Array.from(create).find((b) => b.closest('form') === null && !b.getAttribute('role'))!))
      const noTitle = pop.querySelector('p.text-red-500')?.textContent
      fireEvent.change(pop.querySelector('#newTaskTitle')!, { target: { value: 'משימה חדשה' } })
      await act(async () => fireEvent.click(Array.from(pop.querySelectorAll('button')).find((b) => b.closest('form') === null && !b.getAttribute('role'))!))
      const noLead = pop.querySelector('p.text-red-500')?.textContent
      if (locale !== 'ar') expect([noTitle, noLead], locale).toEqual(messages[locale])
      else expect([noTitle, noLead].every((m) => m && !/[֐-׿]/.test(m)), locale).toBe(true)
      const leadInput = pop.querySelector('input[role="combobox"]') as HTMLInputElement
      fireEvent.focus(leadInput)
      fireEvent.mouseDown(pop.querySelector('[role="listbox"] [role="option"]')!)
      await act(async () => fireEvent.click(Array.from(pop.querySelectorAll('button')).find((b) => b.closest('form') === null && !b.getAttribute('role'))!))
      sent[locale] = S.addTask.mock.calls.map((c) => [c[0], c[2]])
      cleanup()
      resetGSpies()
      resetGlobalEnv()
    }
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
    expect(sent.he).toEqual([['41', 'משימה חדשה']])
  })
})

describe('/files behaves the same in every language', () => {
  test('filters pick the same rows; delete sends the same file; Escape deletes nothing', async () => {
    const out: Record<string, unknown> = {}
    const rows = (c: HTMLElement) => Array.from(c.querySelectorAll('tbody input[name="checkRow"]')).map((i) => i.id)
    for (const locale of LOCALES) {
      const { container } = await page(locale, 'files')
      const [typeSel, sizeSel, leadSel] = Array.from(container.querySelectorAll('select'))
      const r: unknown[] = []
      fireEvent.change(typeSel, { target: { value: 'pdf' } })
      r.push(rows(container))
      fireEvent.change(typeSel, { target: { value: '' } })
      fireEvent.change(sizeSel, { target: { value: String(10 * 1024 * 1024) } })
      r.push(rows(container))
      fireEvent.change(sizeSel, { target: { value: '' } })
      fireEvent.change(leadSel, { target: { value: '42' } })
      r.push(rows(container))
      fireEvent.change(leadSel, { target: { value: '' } })
      // The table re-keys on every render (`key={Math.random()}`), so the row button is re-queried.
      const trigger = () => container.querySelector('tbody td.sticky button') as HTMLButtonElement
      fireEvent.click(trigger())
      fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: 'Escape' })
      r.push(document.querySelector('[role="dialog"]') === null, S.deleteFile.mock.calls.length)
      fireEvent.click(trigger())
      const dlg = document.querySelector('[role="dialog"]')!
      await act(async () => fireEvent.click(Array.from(dlg.querySelectorAll('button')).pop()!))
      r.push(S.deleteFile.mock.calls.map((c) => (c[0] as { id: number }).id))
      out[locale] = r
      cleanup()
      resetGSpies()
    }
    expect(out.en).toEqual(out.he)
    expect(out.ar).toEqual(out.he)
    expect(out.he).toEqual([['71'], ['71', '72', '73'], ['72'], true, 0, [71]])
  })
})
