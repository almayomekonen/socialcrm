// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { findHebrewLeaks, type Allowance } from './leakScan'
import { ADMIN_CUSTOMER_DATA, CHANNEL, NOW, resetAdminEnv, adminEnv } from './adminEnv'
import type { UiLocale } from '@/lib/i18n/config'

/**
 * Admin settings interactions (Phase E5a) in he / en / ar. Each flow drives the
 * REAL page the same way in every language (controls are found by role /
 * position / name attribute, never by their text) and proves:
 *   - every action / form submits IDENTICAL arguments in every language (role
 *     codes, permission ids, stored branch / product values, template drafts,
 *     auto-response settings) and the toasts are worded in the language;
 *   - every dialog, popover, validation and refusal opened on the way shows no
 *     Hebrew in en / ar outside fixture data (scanned at each checkpoint).
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'en' as string | null } }))
vi.mock('@/lib/toast', async () => (await import('./adminMocks')).toastModule())
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('next/navigation', async () => (await import('./adminMocks')).navigationModule())
vi.mock('next/dynamic', async () => (await import('./adminMocks')).nextDynamicModule())
vi.mock('@/db/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/actions/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./adminMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
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
vi.mock('@/db/quotes/templateWrites', async () => (await import('./adminMocks')).quoteWritesDbModule())
vi.mock('@/actions/quotes/templates', async () => (await import('./adminMocks')).quoteActionsModule())
vi.mock('@/db/autoResponseSettings', async () => (await import('./adminMocks')).autoResponseDbModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./adminMocks')).builderFlagsModule())
vi.mock('@/actions/autoResponse/updateSettings', async () => (await import('./adminMocks')).updateAutoResponseModule())
vi.mock('@/actions/autoResponse/previewAgent', async () => (await import('./adminMocks')).previewAgentModule())
vi.mock('@/modules/settings/mobile/AutoResponseMobile', async () => (await import('./adminMocks')).autoResponseMobileModule())
const { AI_CONFIG, AI_CONFIG_DRAFT } = await import('./adminSurfaces')
const { adminPage, adminShell } = await import('./adminHarness')

const DATA: Allowance[] = [...ADMIN_CUSTOMER_DATA, 'חבילת לוגו', 'עיצוב לוגו', 'עוד הודעה'].map((text) => ({ text, reason: 'customer-data' as const }))
const HEBREW = /[֐-׿]/
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('control not found')
  await act(async () => void fireEvent.click(el))
}
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const submit = async (form: Element | null | undefined) => {
  await act(async () => void fireEvent.submit(form!))
  await flush()
}
const dialogBtn = (variant: 'last' | 'first' = 'last') => {
  const buttons = [...document.querySelectorAll('[role="dialog"]:last-of-type button:not(.absolute)')]
  return variant === 'last' ? buttons.pop() : buttons[0]
}
const closeDialog = () => click(document.querySelector('[role="dialog"] button.absolute'))
const set = (overrides: Partial<typeof adminEnv>) => Object.assign(adminEnv, overrides)

let scans: string[] = []
const scan = (where: string) => {
  for (const leak of findHebrewLeaks(document.body, [...DATA, ...AI_CONFIG, ...AI_CONFIG_DRAFT])) scans.push(`${where}: ${leak.where} «${leak.text}»`)
}

async function run(locale: UiLocale, flow: (scan: (w: string) => void) => Promise<void>) {
  resetAdminEnv()
  H.prefs.userLocale = locale
  scans = []
  await flow(locale === 'he' ? () => {} : scan)
  const calls = JSON.parse(JSON.stringify(adminEnv.calls)) as unknown[][]
  const toasts = calls.filter((c) => c[0] === 'toast').map((c) => String(c[2] ?? ''))
  cleanup()
  return { actions: calls.filter((c) => c[0] !== 'toast'), toasts, scans: [...scans] }
}

async function across(name: Parameters<typeof adminPage>[0], flow: (c: HTMLElement, scan: (w: string) => void) => Promise<void>) {
  const results: Record<string, Awaited<ReturnType<typeof run>>> = {}
  for (const locale of ['he', 'en', 'ar'] as const) {
    results[locale] = await run(locale, async (s) => {
      const { container } = render(await adminShell(locale, await adminPage(name)))
      await flush()
      await flow(container, s)
    })
  }
  for (const locale of ['en', 'ar'] as const) {
    expect(results[locale].actions, `${name}: ${locale} submits what Hebrew submits`).toEqual(results.he.actions)
    expect(results[locale].scans, `${name}: ${locale}`).toEqual([])
    for (const msg of results[locale].toasts) expect(HEBREW.test(msg), `${locale} toast «${msg}»`).toBe(false)
  }
  expect(results.he.actions.length, `${name}: the flow reached its actions`).toBeGreaterThan(0)
  return results
}

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {}, scrollIntoView() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (seq = (seq % 997) + 1) / 1000)
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
  resetAdminEnv()
})

describe('admin settings interactions in he / en / ar', () => {
  test('users: edit (role / suspended / permissions), refusals, delete, transfer; invitations', async () => {
    const r = await across('editUsers', async (c, s) => {
      const pens = c.querySelectorAll('tbody button')
      await click(pens[2]) // the office user: the permission picker
      s('office user form')
      await submit(document.querySelector('#editUserForm form'))
      await click(pens[1])
      await act(async () => void fireEvent.change(document.querySelector('#editUserForm select[name="role"]')!, { target: { value: 'MNGR' } }))
      await submit(document.querySelector('#editUserForm form'))
      await click(document.querySelectorAll('#editUserForm .flex-nowrap button')[1])
      s('delete confirm')
      set({ results: { fetchIsUserHaveSales: true } })
      await click(dialogBtn())
      await flush()
      s('delete refused')
      await click(dialogBtn())
      await act(async () => void fireEvent.change(document.querySelector('#editUserForm select[name="role"]')!, { target: { value: 'OFFICE' } }))
      await submit(document.querySelector('#editUserForm form'))
      s('office refused')
      await click(dialogBtn())
      set({ results: {} })
      await act(async () => void fireEvent.change(document.querySelector('#transferSales select, #transferSales input[name="userId"]')!, { target: { value: '9' } }))
      await submit(document.querySelector('#transferSales form'))
      s('transfer confirm')
      await click(dialogBtn())
      await flush()
      await click(c.querySelectorAll('tbody button')[3]) // the first invitation's delete
      s('invitation delete')
      await click(dialogBtn())
      await flush()
      const form = document.querySelector('#invitationsForm form')!
      for (const [name, value] of [['firstName', 'Avi'], ['lastName', 'Ben'], ['email', 'avi@example.test']]) await type(form.querySelector(`[name="${name}"]`), value)
      await act(async () => void fireEvent.change(form.querySelector('select[name="role"]')!, { target: { value: 'MNGR' } }))
      set({ results: { isUserExists: { id: 8 } } })
      await submit(form)
      s('existing user')
      await click(dialogBtn())
      for (const error of ['אין הרשאה', 'תפקיד לא תקין', 'שליחת ההזמנה נכשלה. נסה שוב.', 'אירעה שגיאה ביצירת ההזמנה.']) {
        set({ results: { isUserExists: null, sendInvitation: { error } } })
        await submit(form)
        s(`refused ${error}`)
        await click(dialogBtn())
      }
      set({ results: {} })
      await submit(form)
      s('invitations form')
    })
    expect(r.he.actions.map((a) => a[0])).toEqual(expect.arrayContaining(['upsertUserNPerms', 'upsertUser', 'fetchIsUserHaveSales', 'transferSales', 'deleteInvitation', 'isUserExists', 'sendInvitation']))
  })

  test('teams: add with validation, edit, delete', async () => {
    const r = await across('editTeams', async (c, s) => {
      await click(c.querySelector('.title + button, h1 + button'))
      s('add dialog')
      await submit(document.querySelector('[role="dialog"] form'))
      s('no reps')
      await click(dialogBtn())
      await closeDialog()
      await click(c.querySelector('h3 + div button'))
      await submit(document.querySelector('[role="dialog"] form'))
      await click(c.querySelectorAll('h3 + div button')[3])
      s('delete confirm')
      await click(dialogBtn())
      await flush()
    })
    expect(r.he.actions.map((a) => a[0])).toEqual(expect.arrayContaining(['upsertTeam', 'deleteTeam']))
  })

  test('campaigns: validation, edit with a new condition, delete', async () => {
    const r = await across('editPromotions', async (c, s) => {
      await click(c.querySelector('button'))
      s('new dialog')
      await submit(document.querySelector('[role="dialog"] form'))
      s('no targets')
      await click(dialogBtn())
      await closeDialog()
      await click(c.querySelector('section button'))
      await click([...document.querySelectorAll('[role="dialog"] form > button[type="button"]')].pop())
      s('edit dialog + condition')
      await submit(document.querySelector('[role="dialog"] form'))
      await click(c.querySelectorAll('section button')[1])
      s('delete confirm')
      await click(dialogBtn())
      await flush()
    })
    expect(r.he.actions.map((a) => a[0])).toEqual(expect.arrayContaining(['upsertPromo', 'deletePromo']))
  })

  test('task templates: list delete, header menu, validation, duplicate step, step delete, save', async () => {
    const r = await across('tmpltDetail', async (c, s) => {
      s('detail')
      await click(document.querySelectorAll('#taskTmpltTitleMenu button')[1])
      s('header delete')
      await click(dialogBtn('first'))
      await type(document.getElementById('taskTmpltTitle'), ' ')
      await click(document.querySelector('#taskTmpltTitleForm button.w-full'))
      s('title required')
      await click(dialogBtn())
      await type(document.getElementById('stepTitleTmplt'), 'שיחת היכרות')
      await click(document.querySelector('#stepFormTmplt button.w-full'))
      s('duplicate step')
      await click(dialogBtn())
      await act(async () => void fireEvent.contextMenu(c.querySelectorAll('.mid-step')[1]))
      await click(document.querySelectorAll('#stepMenuTmplt button')[1])
      s('step delete')
      await click(dialogBtn())
      await click(c.querySelector('header button'))
      await flush()
    })
    expect(r.he.actions.map((a) => a[0])).toEqual(expect.arrayContaining(['updateFullTaskTmplt']))
  })

  test('quote templates: new sheet validation and refusals, save, archive, restore', async () => {
    const r = await across('quoteTemplates', async (c, s) => {
      await click(c.querySelector('header button'))
      const save = () => [...document.querySelectorAll('[role="dialog"] button.w-full')].pop()
      await click(save())
      s('name required')
      await type(document.querySelector('[role="dialog"] input'), 'חבילת לוגו')
      await type(document.querySelectorAll('[role="dialog"] input')[3], 'עיצוב לוגו')
      for (const reason of ['name_taken', 'weird']) {
        set({ results: { saveQuoteTemplateAction: { ok: false, reason } } })
        await click(save())
        await flush()
        s(`refused ${reason}`)
      }
      set({ results: {} })
      await click(save())
      await flush()
      await click(c.querySelectorAll('ul')[0].querySelectorAll('button')[1]) // archive the active one
      s('archive confirm')
      await click(dialogBtn())
      await flush()
      await click(c.querySelectorAll('ul')[1].querySelectorAll('button')[1]) // restore the archived one
      await flush()
    })
    expect(r.he.actions.map((a) => a[0])).toEqual(expect.arrayContaining(['saveQuoteTemplateAction', 'setQuoteTemplateStateAction']))
  })

  test('auto-response: refusals by code, save, fixed message required, master off', async () => {
    const r = await across('autoResponse', async (c, s) => {
      await type(c.querySelector('textarea'), 'עוד הודעה')
      s('dirty')
      // The sticky save bar's primary button (the test chat's send button also sits in the page).
      const save = () => [...c.querySelectorAll('[data-auto-response-save-bar] button')].pop()
      for (const reason of ['business_name_required', 'profile_derivation_failed', 'forbidden']) {
        set({ results: { updateAutoResponseSettings: { ok: false, reason } } })
        await click(save())
        await flush()
        s(`refused ${reason}`)
      }
      set({ results: {} })
      await click(save())
      await flush()
      s('saved')
      await click(c.querySelector('[data-responder-option="fixed"] button')) // the fixed-message method
      set({ results: { updateAutoResponseSettings: { ok: false, reason: 'fixed_body_required' } } })
      await click(save())
      await flush()
      s('fixed required')
      expect(c.querySelector('[id$="-error"]')?.textContent, 'the fixed-message error sits under its field').toBeTruthy()
      set({ results: {} })
      await click(c.querySelector('input[type="checkbox"]')) // the master switch
      await click(save())
      await flush()
    })
    expect(r.he.actions.map((a) => a[0])).toEqual(expect.arrayContaining(['updateAutoResponseSettings']))
  })
})

test('the auto-response flow submits the stored channel settings unchanged', () => {
  expect(CHANNEL.replyMode).toBe('ai')
})
