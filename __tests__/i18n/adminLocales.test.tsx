// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, render } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'
import { ADMIN_CUSTOMER_DATA, NOW, resetAdminEnv } from './adminEnv'
import { expectStickyEdges } from './stickyActionsEdge'

/**
 * Admin settings pages (Phase E5a) in en / ar: every registered page state (the
 * leak-gate surfaces) declares its language, shows no Hebrew outside data and
 * the Smart Agent's own configuration, and nothing in it is declared Hebrew
 * except those AI islands; Hebrew declares nothing; tab titles; a language
 * switch within one session; hydration he / en / ar.
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
const { ADMIN_SURFACES, AI_CONFIG } = await import('./adminSurfaces')
const { adminPage, adminShell, withAdminEnv } = await import('./adminHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIR = { en: 'ltr', ar: 'rtl' } as const
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => parts.forEach((p) => expect(text, p).toContain(p))
const DATA = ADMIN_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
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

/** What each surface must say in English (a sample per screen). */
const EN: Record<string, string[]> = {
  'admin settings — refused for a non-admin': ["You don't have permission to view this page"],
  'admin — users + invitations': ['Edit users', 'Invitations', 'All roles', 'Name', 'Role', 'Permissions given', 'Sales rep', 'Operations', 'Admin', 'Edit', 'Invite user', 'Awaiting acceptance', 'Expired', 'Expiry date', 'Personal details', 'Save details', 'Account suspended', 'Transfer leads to a rep', 'Send invitation', 'New user'],
  'admin — users, no invitations': ['Edit users', 'Invitations'],
  'admin — teams': ['Edit teams', 'Add team', 'Managers', 'Reps (1)', 'Operations staff'],
  'admin — teams, none yet': ['Edit teams', 'Add team', 'No teams yet'],
  'admin — campaigns': ['New campaign'],
  'admin — campaigns, none yet': ['No campaigns yet'],
  'admin — task templates': ['Create a new task template', 'Title', 'Created on'],
  'admin — task templates, none yet': ['No templates yet'],
  'admin — a task template (steps, notes, files)': ['Save changes', 'Subtask', 'Step title', 'Subtask title', 'Description', 'Edit', 'Delete template', 'Related documents'],
  'admin — quote templates (active + archive)': ['Quote templates', 'New quote', 'Archive', '2 lines', ' · 1 optional', 'before VAT', 'Valid for 14 days', 'Valid for one day', 'Active', 'Archived', 'Updated 2 h ago', 'Updated 3 days ago', 'Restore'],
  'admin — quote templates, none yet': ['No quote templates yet', 'A template gathers the prices you offer'],
  'admin — quote templates, subscription expired': ['Renewing the subscription brings back editing quote templates'],
  'admin — auto-response, smart reply': ['Auto response', 'WhatsApp auto response', 'On', 'Reply style', 'Smart reply', 'Fixed message', 'Advanced settings', 'Timing and limits', 'Wait before sending', 'seconds', 'Maximum replies per day', 'Save changes', 'Cancel'],
  'admin — auto-response, fixed message, questionnaire answering (Builder)': ['How WhatsApp inquiries are answered', 'Smart AI agent', 'Structured questionnaire', 'Active now: structured questionnaire', 'Edit the questionnaire', 'The agent settings are hidden because the questionnaire is active.'],
  'admin — auto-response off, questionnaire set up by staff, expired': ['Off', 'No reply is being sent on any channel right now.', 'Structured questionnaire', 'Active now: structured questionnaire', 'Renewing the subscription brings back auto response'],
}
const AI_TEXTS = AI_CONFIG.map((a) => a.text)

describe('admin settings pages in en / ar', () => {
  for (const surface of ADMIN_SURFACES) {
    test(surface.name, async () => {
      for (const locale of ['en', 'ar'] as const) {
        H.prefs.userLocale = locale
        const { container } = render(await surface.render(locale))
        const declared = container.querySelector(`[lang="${locale}"]`)
        expect([declared?.getAttribute('lang'), declared?.getAttribute('dir')], `${locale} ${surface.name}`).toEqual([locale, DIR[locale]])
        expect(findHebrewLeaks(container, [...surface.allowed, ...DATA], new Set()), `${locale} ${surface.name}`).toEqual([])
        // Only the Smart Agent's own configuration is declared Hebrew, and every such island holds it.
        for (const he of container.querySelectorAll('[lang="he"]')) {
          expect(he.getAttribute('dir')).toBe('rtl')
          expect(AI_TEXTS.some((t) => (he.textContent ?? '').includes(t)), `${locale} ${surface.name}: ${he.textContent?.slice(0, 60)}`).toBe(true)
        }
        if (locale === 'en') has(textOf(container), ...(EN[surface.name] ?? []))
        cleanup()
      }
      H.prefs.userLocale = 'he'
      const { container } = render(await surface.render('he'))
      expect(container.querySelector('[lang]'), `he ${surface.name}: Hebrew declares nothing`).toBeNull()
    })
  }

  test('Arabic samples', async () => {
    H.prefs.userLocale = 'ar'
    const users = render(await adminShell('ar', await withAdminEnv({}, () => adminPage('editUsers'))))
    has(textOf(users.container), 'تعديل المستخدمين', 'الدعوات', 'مندوب مبيعات', 'دعوة مستخدم')
    cleanup()
    const quotes = render(await adminShell('ar', await withAdminEnv({}, () => adminPage('quoteTemplates'))))
    has(textOf(quotes.container), 'قوالب عروض الأسعار', 'سطران', 'الصلاحية 14 يومًا', 'الصلاحية يوم واحد')
  })
})

describe('tab titles, language switch, hydration', () => {
  test('the admin group, quote templates and auto-response titles follow the interface language', async () => {
    const group = await import('@/app/(he)/(app)/settings/(admin_settings)/layout')
    const quotes = await import('@/app/(he)/(app)/settings/(admin_settings)/quote-templates/page')
    const auto = await import('@/app/(he)/(app)/settings/(admin_settings)/auto-response/page')
    for (const [locale, g, q, a] of [
      ['he', 'הגדרות אדמין', 'תבניות הצעות מחיר', 'מענה אוטומטי'],
      ['en', 'Admin settings', 'Quote templates', 'Auto response'],
      ['ar', 'إعدادات المسؤول', 'قوالب عروض الأسعار', 'الرد التلقائي'],
    ] as const) {
      H.prefs.userLocale = locale
      expect((await group.generateMetadata()).title, locale).toBe(g)
      expect((await quotes.generateMetadata()).title, locale).toBe(q)
      expect((await auto.generateMetadata()).title, locale).toBe(a)
    }
  })

  test('a page re-renders in the new language within one session', async () => {
    H.prefs.userLocale = 'en'
    const node = await withAdminEnv({}, () => adminPage('editTeams'))
    const v = render(await adminShell('en', node))
    has(textOf(v.container), 'Edit teams', 'Add team')
    v.rerender(await adminShell('ar', node))
    has(textOf(v.container), 'تعديل الفرق', 'إضافة فريق')
    v.rerender(await adminShell('he', node))
    has(textOf(v.container), 'עריכת צוותים', 'הוספת צוות')
    expect(v.container.querySelector('[lang]')).toBeNull()
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const name of ['editUsers', 'editTeams', 'editPromotions', 'editTmplts', 'tmpltDetail', 'quoteTemplates', 'autoResponse'] as const) {
      test(`hydration ${locale} · ${name}`, async () => {
        H.prefs.userLocale = locale
        const node = await adminShell(locale, await withAdminEnv({}, () => adminPage(name)))
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

describe('the users and invitations actions columns pin to the end of the row (final UI audit)', () => {
  test('he / ar pinned left as before, en pinned right', async () => {
    const seen = {} as Record<'he' | 'en' | 'ar', HTMLElement>
    for (const l of ['he', 'en', 'ar'] as const) {
      H.prefs.userLocale = l
      const { container } = render(await adminShell(l, await withAdminEnv({}, () => adminPage('editUsers'))))
      expect(container.querySelectorAll('table').length, l).toBe(2)
      seen[l] = container.cloneNode(true) as HTMLElement
      cleanup()
    }
    expectStickyEdges(seen)
  })
})
