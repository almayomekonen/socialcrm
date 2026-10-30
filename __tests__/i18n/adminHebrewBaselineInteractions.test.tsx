// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NOW, resetAdminEnv, adminEnv } from './adminEnv'
import { adminPage, adminShell, type AdminPage } from './adminHarness'

/**
 * HEBREW BASELINE — admin settings interactions (Phase E5a): the users table
 * (edit / delete / refused delete / office switch refused / role filter,
 * transfer deals), invitations (delete, the form: existing user, refusals,
 * success), teams (add / edit / validation / delete), campaigns (new / edit /
 * validation / conditions / delete) and task templates (list delete, the
 * template's header menu, title form, steps, sub-tasks, notes). Recorded BEFORE
 * Phase E5 on unmodified product code, with each action's arguments.
 */

vi.mock('next/navigation', async () => (await import('./adminMocks')).navigationModule())
vi.mock('next/dynamic', async () => (await import('./adminMocks')).nextDynamicModule())
vi.mock('@/lib/toast', async () => (await import('./adminMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/actions/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./adminMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./adminMocks')).deviceModule())
vi.mock('@/lib/access/productAccess', async () => (await import('./adminMocks')).productAccessModule())
vi.mock('@/config/db', async () => (await import('./adminMocks')).configDbModule())
vi.mock('@/db/usersNTeams', async () => (await import('./adminMocks')).usersNTeamsDbModule())
vi.mock('@/db/invitations', async () => (await import('./adminMocks')).invitationsDbModule())
vi.mock('@/actions/usersNteams', async () => (await import('./adminMocks')).usersNteamsActionsModule())
vi.mock('@/actions/invitations', async () => (await import('./adminMocks')).invitationsActionsModule())
vi.mock('@/actions/global', async () => (await import('./adminMocks')).globalActionsModule())
vi.mock('@/db/promos', async () => (await import('./adminMocks')).promosDbModule())
vi.mock('@/actions/promos', async () => (await import('./adminMocks')).promosActionsModule())
vi.mock('@/actions/files', async () => (await import('./adminMocks')).filesActionsModule())
vi.mock('@/db/tasks', async () => (await import('./adminMocks')).tasksDbModule())
vi.mock('@/actions/tasks', async () => (await import('./adminMocks')).tasksActionsModule())

const norm = (html: string) => html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const set = (overrides: Partial<typeof adminEnv>) => Object.assign(adminEnv, overrides)
const calls = () => JSON.parse(JSON.stringify(adminEnv.calls))
const dialogs = () => norm([...document.querySelectorAll('[role="dialog"]')].map((d) => d.outerHTML).join('\n'))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const confirm = () => click([...document.querySelectorAll('[role="dialog"] button')].filter((b) => b.textContent === 'אישור').pop())
const submit = async (form: Element | null) => {
  await act(async () => void fireEvent.submit(form!))
  await flush()
}
const save = (id: string) => [...document.querySelectorAll(`#${id} button`)].find((b) => b.textContent === 'שמירה')
const type = (el: Element | null, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const mount = async (name: AdminPage) => render(await adminShell(null, await adminPage(name)))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // Deterministic but distinct (several lists key their rows by Math.random()).
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (seq = (seq % 997) + 1) / 1000)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAdminEnv()
})

describe('Hebrew baseline — admin settings interactions', () => {
  test('users: edit form for each role, delete confirm / refused, office switch refused, role filter, transfer deals', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount('editUsers')
    const pens = container.querySelectorAll('button[aria-label="עריכת נציג"]')
    await click(pens[1])
    out.editAgent = norm(document.getElementById('editUserForm')!.outerHTML)
    await click(pens[2])
    out.editOffice = norm(document.getElementById('editUserForm')!.outerHTML)
    await click(pens[1])
    await click(document.querySelector('#editUserForm button[aria-label="מחיקת נציג"]'))
    out.deleteConfirm = dialogs()
    set({ results: { fetchIsUserHaveSales: true } })
    await confirm()
    await flush()
    out.deleteRefused = dialogs()
    await confirm()
    await act(async () => void fireEvent.change(document.querySelector('#editUserForm select[name="role"]')!, { target: { value: 'OFFICE' } }))
    await submit(document.querySelector('#editUserForm form'))
    out.officeRefused = dialogs()
    await confirm()
    set({ results: {} })
    await submit(document.querySelector('#editUserForm form'))
    out.transferPopover = norm(document.getElementById('transferSales')!.outerHTML)
    await act(async () => void fireEvent.change(container.querySelector('select:not([name])')!, { target: { value: 'OFFICE' } }))
    out.filteredRows = container.querySelectorAll('tbody tr').length
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('invitations: delete confirm, form — existing user, refusals, failure, success', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount('editUsers')
    await click(container.querySelector('button[aria-label="מחיקת הזמנה"]'))
    out.deleteConfirm = dialogs()
    await confirm()
    await flush()
    out.form = norm(document.getElementById('invitationsForm')!.outerHTML)
    const form = document.querySelector('#invitationsForm form')!
    set({ results: { isUserExists: { id: 8 } } })
    await submit(form)
    out.existing = dialogs()
    await confirm()
    for (const error of ['אין הרשאה', 'תפקיד לא תקין', 'שליחת ההזמנה נכשלה. נסה שוב.', 'אירעה שגיאה ביצירת ההזמנה.']) {
      set({ results: { isUserExists: null, sendInvitation: { error } } })
      await submit(form)
      out[`refused:${error}`] = dialogs()
      await confirm()
    }
    set({ results: { isUserExists: null, sendInvitation: 'throw' } })
    await submit(form)
    out.thrown = dialogs()
    await confirm()
    set({ results: {} })
    await submit(form)
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('teams: add, edit, validation (no reps / manager is a rep), delete', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount('editTeams')
    await click(screen.getByText('הוספת צוות').closest('button'))
    out.addDialog = dialogs()
    await submit(document.querySelector('[role="dialog"] form'))
    out.noReps = dialogs()
    await confirm()
    await click(document.querySelector('[role="dialog"] button[aria-label="סגירה"], [role="dialog"] button.absolute'))
    await click(container.querySelector('button[aria-label="עריכת צוות"]'))
    out.editDialog = dialogs()
    await submit(document.querySelector('[role="dialog"] form'))
    await click(container.querySelectorAll('button[aria-label="מחיקת צוות"]')[1])
    out.deleteConfirm = dialogs()
    await confirm()
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('campaigns: new, edit, add / remove condition, validation, delete', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount('editPromotions')
    await click(screen.getByText('מבצע חדש').closest('button'))
    out.newDialog = dialogs()
    await submit(document.querySelector('[role="dialog"] form'))
    out.validation = dialogs()
    await confirm()
    await click(document.querySelector('[role="dialog"] button.absolute'))
    await click(container.querySelector('button[aria-label="עריכת קמפיין"]'))
    await click(screen.getByText('הוספת תנאים').closest('button'))
    out.editDialog = dialogs()
    await click(document.querySelector('[role="dialog"] button[aria-label="הסרת תנאי 1"]'))
    await submit(document.querySelector('[role="dialog"] form'))
    await click(container.querySelector('button[aria-label="מחיקת קמפיין"]'))
    out.deleteConfirm = dialogs()
    await confirm()
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('task templates: list delete; template header menu, title validation, steps, sub-tasks, duplicate title, notes, save', async () => {
    const out: Record<string, unknown> = {}
    let view = await mount('editTmplts')
    await act(async () => void fireEvent.click(view.container.querySelector('input[name="checkRow"]')!))
    out.selected = norm(view.container.innerHTML)
    await click(screen.getByText('מחק תבנית').closest('button'))
    out.listDelete = dialogs()
    await confirm()
    await flush()
    cleanup()
    view = await mount('tmpltDetail')
    await flush()
    out.detail = norm(view.container.innerHTML)
    await click(screen.getAllByText('מחק תבנית').pop()!.closest('button'))
    out.headerDelete = dialogs()
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'ביטול'))
    await type(document.getElementById('taskTmpltTitle'), ' ')
    await click(save('taskTmpltTitleForm'))
    out.titleRequired = dialogs()
    await confirm()
    await type(document.getElementById('stepTitleTmplt'), 'שיחת היכרות')
    await click(save('stepFormTmplt'))
    out.stepDuplicate = dialogs()
    await confirm()
    await type(document.getElementById('subTaskTitleTmplt'), '')
    await click(save('subTaskFormTmplt'))
    out.subTaskRequired = dialogs()
    await confirm()
    await act(async () => void fireEvent.contextMenu(screen.getByText('לברר צורך')))
    await click(document.querySelector('#subTaskMenuTmplt button:last-child'))
    out.subTaskDelete = dialogs()
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'ביטול'))
    await act(async () => void fireEvent.contextMenu(screen.getByText('הצעת מחיר')))
    await click(document.querySelector('#stepMenuTmplt button:last-child'))
    out.stepDelete = dialogs()
    await confirm()
    await click(screen.getByText('שמירת שינויים').closest('button'))
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })
})
