// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NOW, SUPPORT_CUSTOMER_DATA, requestRow, resetTrialSupportEnv, trialSupportEnv as env } from './trialSupportEnv'
import { resolveAsync } from './dashboardHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * Locale tests for the support centre (i18n Phase F5). The language is the
 * signed-in user's (`getUiLocaleState`, resolved once by the layout and once
 * per page): en / ar → translated, the shell's root declares the region, the
 * customer's subjects and messages keep their own direction; outside the
 * rollout → Hebrew. Every page and article, the tab titles, hydration
 * (he / en / ar) and a language switch within one session.
 */

vi.mock('next/navigation', async () => (await import('./trialSupportMocks')).navigationModule())
vi.mock('@/db/auth', async () => (await import('./trialSupportMocks')).authDbModule())
vi.mock('@/lib/requireUser', async () => (await import('./trialSupportMocks')).requireUserModule())
vi.mock('@/db/uiLocale', async () => (await import('./trialSupportMocks')).uiLocaleDbModule())
vi.mock('@/db/support/requests', async () => (await import('./trialSupportMocks')).supportRequestsDbModule())
vi.mock('@/db/support/messages', async () => (await import('./trialSupportMocks')).supportMessagesDbModule())
vi.mock('@/actions/support/requests', async () => (await import('./trialSupportMocks')).supportActionsModule())
vi.mock('@/lib/toast', async () => (await import('./trialSupportMocks')).toastModule())

const saved = { ...process.env }
const DATA = SUPPORT_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))
type Loc = 'he' | 'en' | 'ar'

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetTrialSupportEnv()
  process.env = { ...saved }
})

function as(locale: Loc | null, flag = true) {
  if (flag) process.env.UI_LOCALE_ENABLED = '1'
  else delete process.env.UI_LOCALE_ENABLED
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
  env.userLocale = locale
}

async function tree(child: () => Promise<unknown>): Promise<ReactNode> {
  const { default: Layout } = await import('@/app/(support)/layout')
  const inner = (await resolveAsync((await child()) as ReactNode)) as ReactNode
  return (await resolveAsync(Layout({ children: inner }) as ReactNode)) as ReactNode
}

const PAGES: Record<string, () => Promise<unknown>> = {
  landing: async () => (await import('@/app/(support)/support/page')).default(),
  requests: async () => (await import('@/app/(support)/support/requests/page')).default(),
  newProblem: async () => (await import('@/app/(support)/support/new/page')).default({ searchParams: Promise.resolve({ kind: 'problem' }) }),
  newQuestion: async () => (await import('@/app/(support)/support/new/page')).default({ searchParams: Promise.resolve({ kind: 'question' }) }),
  thread: async () => (await import('@/app/(support)/support/requests/[requestId]/page')).default({ params: Promise.resolve({ requestId: '41' }) }),
  guides: async () => (await import('@/app/(support)/support/guides/page')).default({ searchParams: Promise.resolve({}) }),
  results: async () => (await import('@/app/(support)/support/guides/page')).default({ searchParams: Promise.resolve({ q: 'whatsapp' }) }),
  noResults: async () => (await import('@/app/(support)/support/guides/page')).default({ searchParams: Promise.resolve({ q: 'zzzz' }) }),
  article: async () => (await import('@/app/(support)/support/guides/[slug]/page')).default({ params: Promise.resolve({ slug: 'connect-whatsapp' }) }),
}

const EXPECT: Record<'en' | 'ar', Record<string, string[]>> = {
  en: {
    landing: ['Support centre', 'I have a problem', 'My requests', 'All requests', 'Back to the app', 'Opened', 'Waiting for your reply', 'Closed', 'In progress', 'a moment ago', '12 minutes ago', 'Looking for an explanation?'],
    requests: ['Your conversations with the SocialCRM team.', 'yesterday', '4 days ago'],
    newProblem: ['What happened?', "We'll get back to you here in the support centre and by email.", 'Send request'],
    newQuestion: ["What's your question?"],
    thread: ['My requests', 'Opened', 'You', 'SocialCRM team', 'Reply', 'Send reply'],
    guides: ['Guides', 'Short explanations by topic.', 'Facebook and Instagram', 'Connecting WhatsApp', "Didn't find what you were looking for?"],
    results: ["WhatsApp messages aren't coming in"],
    noResults: ['No guides found'],
    article: ['Before you start', 'Connection steps', 'Go to Settings, then Integrations.', "Didn't that solve the problem?", 'Tell us what happened'],
  },
  ar: {
    landing: ['مركز الدعم', 'لدي مشكلة', 'طلباتي', 'بانتظار ردك', 'العودة إلى النظام'],
    requests: ['محادثاتك مع فريق SocialCRM.'],
    newProblem: ['ماذا حدث؟', 'إرسال الطلب'],
    newQuestion: ['ما سؤالك؟'],
    thread: ['أنت', 'فريق SocialCRM', 'إرسال الرد'],
    guides: ['الأدلة', 'ربط WhatsApp بالنظام'],
    results: ['رسائل WhatsApp لا تصل'],
    noResults: ['لم يتم العثور على أدلة'],
    article: ['قبل البدء', 'خطوات الربط', 'أخبرنا بما حدث'],
  },
}

describe('support centre in en / ar', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: every page translated, region declared, customer text kept`, async () => {
      as(locale)
      for (const [name, build] of Object.entries(PAGES)) {
        const { container } = render(<>{await tree(build)}</>)
        const root = container.firstElementChild!
        expect([root.getAttribute('lang'), root.getAttribute('dir')], name).toEqual([locale, locale === 'en' ? 'ltr' : 'rtl'])
        expect(findHebrewLeaks(container, DATA), `${locale} ${name}`).toEqual([])
        for (const text of EXPECT[locale][name]) expect(container.textContent, `${locale} ${name}`).toContain(text)
        // Nothing is declared Hebrew: the support centre has no untranslated region.
        expect(container.querySelectorAll('[lang="he"]').length, name).toBe(0)
        // The customer's own words keep their own direction.
        for (const el of container.querySelectorAll('p.whitespace-pre-line, h1 + *, .truncate')) {
          if (/[֐-׿]/.test(el.textContent ?? '')) expect(el.getAttribute('dir'), name).toBe('auto')
        }
        cleanup()
      }
    })

    test(`${locale}: every guide article translated`, async () => {
      as(locale)
      const { GUIDE_ARTICLES } = await import('@/lib/support/knowledgeBase')
      const { default: Page } = await import('@/app/(support)/support/guides/[slug]/page')
      for (const a of GUIDE_ARTICLES) {
        const { container } = render(<>{(await resolveAsync(await Page({ params: Promise.resolve({ slug: a.slug }) }))) as ReactNode}</>)
        expect(findHebrewLeaks(container, []), a.slug).toEqual([])
        expect(container.querySelectorAll('section').length, a.slug).toBe(a.sections.length)
        cleanup()
      }
    })
  }

  test('outside the rollout, without a choice, or Hebrew chosen → the Hebrew pages, no new attribute', async () => {
    const { default: Page } = await import('@/app/(support)/support/page')
    as(null)
    const reference = renderRaw(<>{await tree(PAGES.landing)}</>)
    for (const [locale, flag] of [['he', true], ['en', false]] as const) {
      as(locale, flag)
      expect(renderRaw(<>{await tree(PAGES.landing)}</>)).toBe(reference)
    }
    expect(reference).toContain('dir="rtl"')
    expect(reference).not.toContain('lang=')
    void Page
  })

  test('a fallback subject, a nameless user and a colleague are labelled in the interface language', async () => {
    as('en')
    env.request = requestRow({ subject: 'פנייה חדשה', createdByUserId: 9, requesterNameSnapshot: 'יוסי לוי' })
    env.messages = env.messages.map((m) => ({ ...m, authorUserId: m.authorKind === 'customer' ? 9 : m.authorUserId }))
    env.user = { ...env.user, name: null, firstName: null, lastName: null, gglName: null, email: null }
    const { container } = render(<>{await tree(PAGES.thread)}</>)
    expect(container.querySelector('h1')!.textContent).toBe('New request')
    expect(container.textContent).toContain('User')
    expect(container.textContent).toContain('יוסי לוי')
  })

  test('tab titles', async () => {
    const titles = async () => {
      const of = async (m: { generateMetadata?: (a?: never) => Promise<{ title?: unknown }> }, a?: unknown) => (await m.generateMetadata!(a as never)).title
      return [
        await of(await import('@/app/(support)/support/page')),
        await of(await import('@/app/(support)/support/requests/page')),
        await of(await import('@/app/(support)/support/new/page')),
        await of(await import('@/app/(support)/support/guides/page')),
        await of((await import('@/app/(support)/support/guides/[slug]/page')) as never, { params: Promise.resolve({ slug: 'lead-statuses' }) }),
        await of((await import('@/app/(support)/support/guides/[slug]/page')) as never, { params: Promise.resolve({ slug: 'nope' }) }),
      ]
    }
    as('en')
    expect(await titles()).toEqual(['Support centre', 'My requests', 'New request', 'Guides', 'Lead statuses', 'Guides'])
    as('ar')
    expect(await titles()).toEqual(['مركز الدعم', 'طلباتي', 'طلب جديد', 'الأدلة', 'حالات العملاء المحتملين', 'الأدلة'])
    as(null)
    expect(await titles()).toEqual(['מרכז התמיכה', 'הפניות שלי', 'פנייה חדשה', 'מדריכים', 'סטטוסים של לידים', 'מדריכים'])
  })

  test('switching language within one session re-renders the next page in the new language', async () => {
    as('en')
    const first = render(<>{await tree(PAGES.landing)}</>)
    expect(first.container.textContent).toContain('Support centre')
    cleanup()
    env.userLocale = 'ar'
    const second = render(<>{await tree(PAGES.landing)}</>)
    expect(second.container.textContent).toContain('مركز الدعم')
    expect(second.container.firstElementChild!.getAttribute('lang')).toBe('ar')
  })
})

describe('hydration', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`${locale}: the landing page and a thread hydrate without a mismatch`, async () => {
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
      as(locale === 'he' ? null : locale)
      for (const build of [PAGES.landing, PAGES.thread, PAGES.newProblem]) {
        const t = await tree(build)
        const container = document.createElement('div')
        container.innerHTML = renderRaw(<>{t}</>)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a))
        const recoverable: unknown[] = []
        const root = await act(async () => hydrateRoot(container, <>{t}</>, { onRecoverableError: (e) => void recoverable.push(e) }))
        expect(recoverable).toEqual([])
        expect(errors.filter((e) => String(e).match(/hydrat|did not match/i))).toEqual([])
        act(() => root.unmount())
        spy.mockRestore()
        container.remove()
      }
    })
  }
})
