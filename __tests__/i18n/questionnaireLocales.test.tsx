// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, render } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'
import { NOW, resetQuestionnaireEnv } from './questionnaireEnv'

/**
 * The questionnaire builder (Phase E5c) in en / ar: every registered page
 * state (the leak-gate surfaces) declares its language, shows no Hebrew
 * outside the questionnaire's own content, and declares nothing Hebrew; Hebrew
 * declares nothing; the tab title; a language switch within one session;
 * hydration he / en / ar. Flow map, dialogs, history, test chat:
 * questionnaireLocalesInteractions.
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'en' as string | null } }))
vi.mock('@/lib/toast', async () => (await import('./questionnaireMocks')).toastModule())
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('next/navigation', async () => (await import('./questionnaireMocks')).navigationModule())
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('@/db/auth', async () => (await import('./questionnaireMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./questionnaireMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./questionnaireMocks')).deviceModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./questionnaireMocks')).builderFlagsModule())
vi.mock('@/lib/flags/whatsappQuestionnaireFlags', async () => (await import('./questionnaireMocks')).naturalAnswersFlagsModule())
vi.mock('@/lib/inbox/autoresponse/questionnaire/builder/service', async () => (await import('./questionnaireMocks')).serviceModule())
vi.mock('@/actions/questionnaire/builderDraft', async () => (await import('./questionnaireMocks')).draftActionsModule())
vi.mock('@/actions/questionnaire/builderPublish', async () => (await import('./questionnaireMocks')).publishActionsModule())
const { QUESTIONNAIRE_SURFACES } = await import('./questionnaireSurfaces')
const { questionnairePage, questionnaireShell, withQuestionnaireEnv } = await import('./questionnaireHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIR = { en: 'ltr', ar: 'rtl' } as const
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => parts.forEach((p) => expect(text, p).toContain(p))

const savedEnv = { ...process.env }
beforeAll(() => {
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
  resetQuestionnaireEnv()
})

/** What each surface must say in English (a sample per state). */
const EN: Record<string, string[]> = {
  'questionnaire — list view, published and answering': [
    'WhatsApp questionnaire', 'Version 2 answers new WhatsApp inquiries.', "You're editing a draft.", 'Test the questionnaire', 'Version history', 'Publish',
    'Opening message', 'Questions', 'Question 1', 'What the customer will see', 'How the customer can answer', 'Choose one answer',
    'The customer picks one option from a numbered list', 'Option', 'Icon', 'Add an option', 'Let the customer choose "Other"', 'When a customer chooses',
    'Edit the follow-up question (question 2)', 'The question appears when:', 'The customer chose', 'in the question', 'Change', 'Always appears.',
    'Show only based on an earlier answer', 'Answer check', 'Date', 'Allow "not decided yet" as an answer', 'What is sent when the answer is unclear?',
    'Add a question', 'End of the conversation', 'Different ending by answer', 'Different ending 1', 'Sent when:', 'More messages', 'characters',
    'What the customer will receive', 'Message from the business', 'At the end of the questionnaire:', 'Sent to the customer', 'Hi',
  ],
  'questionnaire — list view, natural answers, auto-response off': ['Version 2 is published, but the auto-response is off right now', 'Customers can answer "all"'],
  'questionnaire — Flow view (header and view switch)': ['How will this look to the customer?', 'Map', 'List', 'Editing the questionnaire is available on a wide screen'],
  'questionnaire — no draft yet (opening it)': ['Opening the questionnaire…'],
  'questionnaire — never published, not switched on': ["The questionnaire hasn't been published yet. Customers don't receive it."],
  'questionnaire — published, not routed': ["Version 2 is published, but the questionnaire isn't switched on in WhatsApp yet."],
  'questionnaire — list view without questions': ['No questions yet. Add the first question.', 'Once you add a question that always appears'],
  'questionnaire — subscription expired': ['Renewing the subscription brings back editing the questionnaire'],
}

describe('questionnaire builder in en / ar', () => {
  for (const surface of QUESTIONNAIRE_SURFACES) {
    test(surface.name, async () => {
      for (const locale of ['en', 'ar'] as const) {
        H.prefs.userLocale = locale
        const { container } = render(await surface.render(locale))
        const declared = container.querySelector(`[lang="${locale}"]`)
        expect([declared?.getAttribute('lang'), declared?.getAttribute('dir')], `${locale} ${surface.name}`).toEqual([locale, DIR[locale]])
        expect(findHebrewLeaks(container, surface.allowed, new Set()), `${locale} ${surface.name}`).toEqual([])
        expect(container.querySelector('[lang="he"]'), `${locale} ${surface.name}: nothing is declared Hebrew`).toBeNull()
        for (const o of container.querySelectorAll('option')) expect(o.textContent, 'select options').not.toMatch(/[֐-׿]/)
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
    const v = render(await questionnaireShell('ar', await withQuestionnaireEnv({ flow: false }, () => questionnairePage())))
    has(textOf(v.container), 'استبيان واتساب', 'الإصدار 2 يرد على الاستفسارات الجديدة في واتساب.', 'اختبار الاستبيان', 'سجل الإصدارات', 'نشر', 'رسالة الافتتاح', 'السؤال 1', 'ختام المحادثة', 'ما سيتلقاه العميل')
  })

  test('business content keeps its own direction inside a translated editor (dir=auto on the fields)', async () => {
    H.prefs.userLocale = 'en'
    const v = render(await questionnaireShell('en', await withQuestionnaireEnv({ flow: false }, () => questionnairePage())))
    const prompts = [...v.container.querySelectorAll('article textarea')]
    expect(prompts.length).toBeGreaterThan(0)
    for (const p of prompts) expect(p.getAttribute('dir')).toBe('auto')
    cleanup()
    H.prefs.userLocale = 'he'
    const he = render(await questionnaireShell('he', await withQuestionnaireEnv({ flow: false }, () => questionnairePage())))
    for (const p of he.container.querySelectorAll('article textarea')) expect(p.hasAttribute('dir')).toBe(false)
  })
})

describe('tab title, language switch, hydration', () => {
  test('the title follows the interface language', async () => {
    const page = await import('@/app/(app)/settings/(admin_settings)/questionnaire/page')
    for (const [locale, title] of [['he', 'שאלון וואטסאפ'], ['en', 'WhatsApp questionnaire'], ['ar', 'استبيان واتساب']] as const) {
      H.prefs.userLocale = locale
      expect((await page.generateMetadata()).title, locale).toBe(title)
    }
  })

  test('the builder re-renders in the new language within one session', async () => {
    H.prefs.userLocale = 'en'
    const node = await withQuestionnaireEnv({ flow: false }, () => questionnairePage())
    const v = render(await questionnaireShell('en', node))
    has(textOf(v.container), 'Test the questionnaire', 'End of the conversation')
    v.rerender(await questionnaireShell('ar', node))
    has(textOf(v.container), 'اختبار الاستبيان', 'ختام المحادثة')
    v.rerender(await questionnaireShell('he', node))
    has(textOf(v.container), 'בדיקת השאלון', 'סיום השיחה')
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, overrides] of [['list', { flow: false }], ['flow', {}], ['expired', { hasAccess: false }]] as const) {
      test(`hydration ${locale} · ${name}`, async () => {
        H.prefs.userLocale = locale
        const node = await questionnaireShell(locale, await withQuestionnaireEnv(overrides, () => questionnairePage()))
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
