// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NOW, resetAdminEnv } from './adminEnv'
import { he } from '@/lib/i18n/messages/he'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Admin settings behaviour (Phase E5a): role pickers keep their codes and
 * order in every language; the catalog's Hebrew is the constants it replaced;
 * server sentences are matched exactly; Escape / focus on dialogs; icon-only
 * controls are named in the language; the Smart Agent's configuration stays a
 * declared Hebrew region.
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
const { adminPage, adminShell } = await import('./adminHarness')
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {}, scrollIntoView() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
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

describe('stored values and codes', () => {
  test('role pickers: the same codes in the same order; Hebrew is rolesOpt itself; labels follow the language', async () => {
    const { adminRoleOptions, adminRoleLabel } = await import('@/components/agntsAndGrps/adminLabels')
    const { rolesOpt, MapRoles } = await import('@/types/roles')
    expect(adminRoleOptions('he')).toBe(rolesOpt)
    for (const locale of ['en', 'ar'] as const) expect(adminRoleOptions(locale).map((o) => o.id)).toEqual(rolesOpt.map((o) => o.id))
    expect(adminRoleOptions('en').map((o) => o.name)).toEqual(['Sales rep', 'Manager', 'Admin', 'General manager', 'Operations'])
    for (const code of Object.keys(MapRoles)) expect(adminRoleLabel(code)).toBe(MapRoles[code as keyof typeof MapRoles])
    expect(adminRoleLabel('NOPE', 'en')).toBeUndefined()
  })

  test('the edit form submits role codes and permission ids (never labels) in every language', async () => {
    const out: Record<string, unknown> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      H.prefs.userLocale = locale
      const { container } = render(await adminShell(locale, await adminPage('editUsers')))
      await act(async () => void fireEvent.click(container.querySelectorAll('tbody button')[2]))
      const form = document.querySelector('#editUserForm form')!
      out[locale] = {
        roles: [...form.querySelectorAll('select[name="role"] option')].map((o) => (o as HTMLOptionElement).value),
        perms: [...form.querySelectorAll('input[name="gotPermIds"], input[name^="gotPermIds"]')].map((i) => (i as HTMLInputElement).value),
      }
      cleanup()
    }
    expect((out.he as { roles: string[] }).roles).toEqual(['AGNT', 'MNGR', 'ADMIN', 'GM', 'OFFICE'])
    expect((out.he as { perms: string[] }).perms.length).toBeGreaterThan(0)
    expect(out.en).toEqual(out.he)
    expect(out.ar).toEqual(out.he)
  })

  test('the catalog Hebrew is the constants it replaced', async () => {
    const copy = await import('@/components/quotes/templateCopy')
    const { MapRoles } = await import('@/types/roles')
    expect(he.admin.users.role).toEqual(MapRoles)
    expect(he.admin.quotes.state).toEqual(copy.TEMPLATE_STATE_LABEL)
    const reasons = Object.keys(he.admin.quotes.error).filter((r) => r !== 'unknown')
    for (const r of reasons) expect(copy.quoteTemplateErrorMessage(r)).toBe(he.admin.quotes.error[r as keyof typeof he.admin.quotes.error])
    expect(copy.quoteTemplateErrorMessage('nope')).toBe(he.admin.quotes.error.unknown)
    // The invitation action's Hebrew answers are matched by exact sentence.
    const action = read('actions/invitations.ts')
    for (const sentence of Object.values(he.admin.invitations.server)) expect(action).toContain(`'${sentence}'`)
  })

  test('producers: Hebrew unchanged, other languages by code; unknown codes stay safe', async () => {
    const copy = await import('@/components/quotes/templateCopy')
    const { invitationErrorText } = await import('@/components/agntsAndGrps/adminLabels')
    const iso = new Date(NOW - 3 * 3_600_000).toISOString()
    expect(copy.updatedLabel(iso, NOW)).toBe('עודכן לפני 3 ש׳')
    expect(copy.updatedLabel(iso, NOW, 'en')).toBe('Updated 3 h ago')
    expect(copy.validityLabelIn(1)).toBe('יום אחד')
    expect(copy.validityLabelIn(2, 'ar')).toBe('يومان')
    expect(copy.quoteTemplateErrorMessage('name_taken', 'en')).toBe('An active template with this name already exists')
    expect(copy.quoteTemplateErrorMessage('constructor', 'en')).toBe("Couldn't save")
    expect(invitationErrorText('אין הרשאה', 'en')).toBe('No permission')
    expect(invitationErrorText('שגיאה אחרת', 'en')).toBe('שגיאה אחרת')
    const { saveErrorCode } = await import('@/components/settings/autoResponse/autoResponseDraft')
    expect(['fixed_body_required', 'business_name_required', 'profile_derivation_failed', 'forbidden', ''].map(saveErrorCode)).toEqual([
      'fixed_body_required', 'business_name_required', 'profile_derivation_failed', 'unknown', 'unknown',
    ])
  })
})

describe('dialogs, names, regions', () => {
  test('Escape closes a confirmation and focus returns to its opener; icon-only controls are named in the language', async () => {
    H.prefs.userLocale = 'en'
    const { container } = render(await adminShell('en', await adminPage('editTeams')))
    const names = [...container.querySelectorAll('h3 + div button')].map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Edit team', 'Delete team', 'Edit team', 'Delete team'])
    const opener = container.querySelectorAll('h3 + div button')[1] as HTMLButtonElement
    opener.focus()
    await act(async () => void fireEvent.click(opener))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('lang')).toBe('en')
    expect(dialog.textContent).toContain('Delete the team צוות צפון?')
    await act(async () => void fireEvent.keyDown(dialog, { key: 'Escape' }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    cleanup()
    const quotes = render(await adminShell('ar', await adminPage('quoteTemplates')))
    expect([...quotes.container.querySelectorAll('ul button')].map((b) => b.textContent)).toContain('إلى الأرشيف')
  })

  test('auto-response: the Smart Agent fields and test chat stay a declared Hebrew region; the rest follows the language', async () => {
    H.prefs.userLocale = 'en'
    const { container } = render(await adminShell('en', await adminPage('autoResponse')))
    const islands = [...container.querySelectorAll('[lang="he"]')]
    // The business description, and the test chat twice: the narrow-screen
    // launcher in the flow and the wide-screen side panel (CSS shows one).
    expect(islands.length).toBe(3)
    expect(islands[0].textContent).toContain('ספרו לסוכן על העסק ומה תרצו שיעשה')
    expect(islands[1].textContent).toContain('בדקו את הסוכן שלכם')
    expect(islands[2].tagName).toBe('ASIDE')
    expect(islands[2].textContent).toContain('בדיקת הסוכן')
    expect(container.firstElementChild?.getAttribute('lang')).toBe('en')
    expect(translatorFor('en')('admin.autoResponse.style.fixedFieldHint')).toContain('{{firstName}}')
  })
})
