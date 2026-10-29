// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ATTRIBUTION, EXPIRED, FAMILY, FORM_ANSWERS, INTELLIGENCE, NOW, SUMMARY_LEAD, TASKS, WA_PREVIEW, detailEnv, resetDetailEnv } from './leadDetailEnv'

/**
 * The lead detail screen (/clients/[clientId] layout + summary) in en / ar:
 * content, region direction, hydration, and external content (Meta, AI,
 * WhatsApp) rendered verbatim. Behaviour: leadDetailBehaviour.test.tsx. Hebrew
 * output is pinned by leadDetailHebrewBaseline.test.tsx.
 */

const H = vi.hoisted(() => ({
  prefs: { userLocale: 'en' as string | null },
  toasts: [] as unknown[][],
  proToasts: [] as { title: string; body: string }[],
  followUp: vi.fn(async (..._a: unknown[]) => ({})),
  clearFollowUp: vi.fn(async (..._a: unknown[]) => ({})),
  outcome: vi.fn(async (..._a: unknown[]) => ({ nextFollowUpAt: null })),
  send: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  refreshReason: 'rate-limited',
}))

vi.mock('next/navigation', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return {
    useSearchParams: () => new URLSearchParams(env.search),
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    usePathname: () => env.pathname,
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
  }
})
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./leadDetailEnv')).DETAIL_USER }))
vi.mock('@/lib/requireUser', async () => ({ requireAgencyUser: async () => (await import('./leadDetailEnv')).DETAIL_USER }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/clients', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return {
    getFullLead: async () => (env.header || env.lead ? { ...(env.header ?? {}), ...(env.lead ?? {}) } : null),
    getFamMembers: async () => ({ famMembers: env.family, familyId: env.family.length ? 1 : null }),
  }
})
vi.mock('@/db/usersNTeams', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getUserNameById: async () => env.handlerName, getUsers: async () => [] }
})
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [], gotPermUsers: [], allPermUsers: [] }) }))
vi.mock('@/db/tasks', async () => ({ get5TasksByClientId: async () => (await import('./leadDetailEnv')).detailEnv.tasks }))
vi.mock('@/modules/inbox/queries', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getInboxConversationByLeadId: async () => (env.conversationId ? { conversationId: env.conversationId } : null) }
})
vi.mock('@/db/inboxMessages', async () => ({ listConversationMessages: async () => (await import('./leadDetailEnv')).detailEnv.messages }))
vi.mock('@/db/leadFormAnswers', async () => ({ formAnswersForLead: async () => (await import('./leadDetailEnv')).detailEnv.formAnswers }))
vi.mock('@/db/adsCrmOutcomes', async () => ({ getLeadAdAttribution: async () => (await import('./leadDetailEnv')).detailEnv.attribution }))
vi.mock('@/db/adsSnapshots', async () => ({ readCreativeForAd: async () => (await import('./leadDetailEnv')).detailEnv.creative }))
vi.mock('@/lib/facebook/permissions', async () => ({ isFacebookAdsReportingEnabledForAgency: () => detailEnv.adsReporting }))
vi.mock('@/lib/whatsapp/templates/flag', async () => ({ isTemplatesEnabledForAgency: () => detailEnv.templatesEnabled }))
vi.mock('@/db/whatsappTemplates', async () => ({ listTemplates: async () => (await import('./leadDetailEnv')).detailEnv.templates }))
vi.mock('@/lib/inbox/whatsappOutboundTarget', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { resolveWhatsappOutboundTarget: async () => (env.reachable ? { ok: true } : { ok: false }) }
})
vi.mock('@/lib/access/productAccess', async () => ({ getAgencyProductAccess: async () => ({ hasAccess: detailEnv.hasAccess }) }))
vi.mock('@/actions/ai/leadIntelligence', async () => ({ getLeadIntelligence: async () => (await import('./leadDetailEnv')).detailEnv.intelligence }))
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: false, reason: H.refreshReason }) }))
vi.mock('@/actions/leadFollowUp', () => ({ setLeadFollowUp: H.followUp, clearLeadFollowUp: H.clearFollowUp }))
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: H.outcome }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: H.send }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/lib/toast', async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...args: unknown[]) => H.toasts.push(args),
  proToast: (opts: { title: string; body: string }) => H.proToasts.push(opts),
}))
vi.mock('@/components/copilot/CopilotLeadContext', () => ({ default: () => null }))
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))
vi.mock('@/components/sales/saleForm/SaleForm', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadDetailMobile', () => ({ default: () => null }))

const { detailLayout, detailShell, summaryPage } = await import('./leadDetailHarness')
const { __resetFirstLeadFlowForTests, beginFirstLeadFlow } = await import('@/components/clients/firstLeadFlow')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const savedEnv = { ...process.env }
beforeAll(() => {
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
  resetDetailEnv()
  __resetFirstLeadFlowForTests()
  H.toasts.length = 0
  H.proToasts.length = 0
  for (const fn of [H.followUp, H.clearFollowUp, H.outcome, H.send]) fn.mockClear()
})

type Loc = 'he' | 'en' | 'ar'
type Ent = typeof EXPIRED

async function layoutTree(locale: Loc, overrides: Partial<typeof detailEnv> = {}) {
  H.prefs.userLocale = locale
  Object.assign(detailEnv, overrides)
  return detailShell(locale, await detailLayout(<div id='tab-content' />))
}

async function summaryTree(locale: Loc, overrides: Partial<typeof detailEnv> = {}, ent?: Ent, clientId = '41') {
  H.prefs.userLocale = locale
  Object.assign(detailEnv, overrides)
  return detailShell(locale, await summaryPage(clientId), ent)
}

// Bidi marks Intl puts in Arabic dates (U+200E/U+200F) are dropped so assertions read plainly.
const textOf = (el: Element) => (el.textContent ?? '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => {
  for (const p of parts) expect(text, p).toContain(p)
}

describe('layout (header + tab nav)', () => {
  test('English: chrome translated, customer data verbatim, regions declared', async () => {
    const { container } = render(await layoutTree('en', { family: FAMILY }))
    const text = textOf(container)
    has(text, 'Lead owner:', 'Male', 'Close deal', '5/1/1990 (36)', 'Lead summary', 'Tasks', 'Files', 'Billing')
    has(text, 'יוסי לוי', 'רחל לוי', 'מנהל ראשי', 'yossi@example.test', '0501234567')
    const header = container.querySelector('.bg-\\[\\#e8ecf4\\]')!
    expect([header.getAttribute('lang'), header.getAttribute('dir')]).toEqual(['en', 'ltr'])
    const nav = container.querySelector('a[href="/clients/41/summary"]')!.parentElement!
    expect([nav.getAttribute('lang'), nav.getAttribute('dir')]).toEqual(['en', 'ltr'])
    // The tab content keeps inheriting <main>'s language: the layout wrapper declares nothing.
    expect(container.querySelector('#tab-content')!.parentElement!.hasAttribute('lang')).toBe(false)
  })

  test('Arabic: chrome translated, right-to-left; an unknown gender value is shown as stored', async () => {
    const { container } = render(await layoutTree('ar', { header: { ...detailEnv.header, gender: 'אחר' } }))
    const text = textOf(container)
    has(text, 'المسؤول عن العميل المحتمل:', 'إغلاق الصفقة', 'ملخص العميل المحتمل', 'المهام', 'الملفات', 'الفوترة', 'אחר')
    const header = container.querySelector('.bg-\\[\\#e8ecf4\\]')!
    expect([header.getAttribute('lang'), header.getAttribute('dir')]).toEqual(['ar', 'rtl'])
  })

  test('Hebrew declares no region (the DOM is the legacy one)', async () => {
    const { container } = render(await layoutTree('he'))
    expect(container.querySelector('[lang]')).toBeNull()
    expect(textOf(container)).toContain('אחראי ליד:')
  })

  test('not found is translated', async () => {
    const { container } = render(await layoutTree('en', { header: null, lead: null }))
    expect(textOf(container)).toBe('This lead was not found')
    expect(container.querySelector('div')!.getAttribute('lang')).toBe('en')
  })

  test('the copy toast is translated', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
    render(await layoutTree('en'))
    fireEvent.click(screen.getByText('yossi@example.test'))
    expect(H.toasts).toEqual([['success', 'yossi@example.test copied to clipboard']])
  })

  test('tab titles follow the interface language (Hebrew outside the rollout)', async () => {
    const { generateMetadata } = await import('@/app/(app)/clients/[clientId]/layout')
    H.prefs.userLocale = 'en'
    expect(await generateMetadata()).toEqual({ title: 'Lead details', description: 'All of the lead’s details' })
    H.prefs.userLocale = 'ar'
    expect((await generateMetadata()).title).toBe('بيانات العميل المحتمل')
    process.env.UI_LOCALE_ENABLED = ''
    expect((await generateMetadata()).title).toBe('נתוני ליד')
    process.env.UI_LOCALE_ENABLED = '1'
  })
})

describe('summary — English', () => {
  test('status card, follow-up, outcome, ready message, intelligence, tasks, activity', async () => {
    const { container } = render(await summaryTree('en'))
    const text = textOf(container)
    has(
      text,
      'In progress',
      'Follow-up: 10/30/2026',
      'Next follow-up: 10/30/2026 · לחזור אחרי החג',
      'Last interaction: We talked · 10/27/2026',
      'Call outcome:',
      'Send a ready message',
      'Smart summary',
      'Medium confidence',
      'Refresh insights',
      'Recommended action',
      'Based on: Lead status · Recent activity',
      'Tasks',
      'All tasks >>',
      'Activity',
      'No activity for this lead yet',
      '10/29/2026',
    )
    // Customer data and AI output are untouched.
    for (const s of [...TASKS.map((t) => t.title), INTELLIGENCE.summary, ...INTELLIGENCE.keyInsights, INTELLIGENCE.suggestedNextAction.title, INTELLIGENCE.suggestedNextAction.reason]) expect(text).toContain(s)
    const root = container.querySelector('[data-edu="lead-status"]')!.closest('[lang]')!
    expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual(['en', 'ltr'])
    // AI text is Hebrew (decision D3): its blocks re-declare Hebrew inside the English card.
    const summary = screen.getByText(INTELLIGENCE.summary)
    expect([summary.getAttribute('lang'), summary.getAttribute('dir')]).toEqual(['he', 'rtl'])
    expect(screen.getByText(INTELLIGENCE.suggestedNextAction.title).getAttribute('lang')).toBe('he')
    expect(screen.getByText(INTELLIGENCE.keyInsights[0]).closest('ul')!.getAttribute('dir')).toBe('rtl')
  })

  test('no follow-up yet, and the first-lead callout', async () => {
    beginFirstLeadFlow(43)
    const { container } = render(await summaryTree('en', { lead: { ...SUMMARY_LEAD, nextFollowUpAt: null, followUpNote: null, lastOutcomeType: null } }, undefined, '43'))
    const text = textOf(container)
    has(text, 'Schedule follow-up', 'No follow-up scheduled', 'Your first lead is in', 'Choose when to get back to them, and SocialCRM will bring them back to you on time.')
    expect(text).not.toContain('Last interaction')
    const callout = container.querySelector('[role="status"]')!
    expect([callout.getAttribute('lang'), callout.getAttribute('dir')]).toEqual(['en', 'ltr'])
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  test('Meta Lead Ads: our chrome translated, the form questions and answers and the ad names verbatim', async () => {
    const { container } = render(
      await summaryTree('en', {
        lead: { ...SUMMARY_LEAD, leadSource: 'instagram:55' },
        attribution: ATTRIBUTION,
        creative: { payload: { imageUrl: 'https://cdn.example.test/ad.jpg' } },
      }),
    )
    const text = textOf(container)
    has(
      text,
      'This lead reached you automatically from Instagram',
      'Captured automatically: Name · Phone · Email',
      'Captured on 10/25/2026, 11:00 AM',
      'Form answers',
      'City',
      'Not answered',
      'Came from a Meta ad · Instagram',
    )
    for (const s of ['חיפה', 'מה התקציב שלך?', 'עד 5,000', 'when do you want to start?', ATTRIBUTION.campaignName, ATTRIBUTION.adsetName, ATTRIBUTION.adName]) expect(text).toContain(s)
    expect(FORM_ANSWERS[0].values[0]).toBe('יוסי לוי') // the contact field itself is not listed as an answer
    expect(text).not.toContain('full name')
    const section = container.querySelector('section')!
    expect([section.getAttribute('lang'), section.getAttribute('dir')]).toEqual(['en', 'ltr'])
    expect(screen.getByRole('link', { name: ATTRIBUTION.campaignName }).getAttribute('href')).toBe('/sum_sales/ads?campaign=1200001')
  })

  test('WhatsApp inbound: the customer message verbatim, the conversation link translated', async () => {
    const { container } = render(await summaryTree('en', { lead: { ...SUMMARY_LEAD, leadSource: 'whatsapp:972501234567' } }))
    const text = textOf(container)
    has(text, 'This lead reached you automatically from WhatsApp', 'SocialCRM captured the lead and the conversation the moment the customer contacted you.', WA_PREVIEW)
    expect(screen.getByRole('link', { name: 'Open the conversation' }).getAttribute('href')).toBe('/inbox?conversation=900')
  })

  test('organic attribution and intelligence error', async () => {
    const { container } = render(
      await summaryTree('en', {
        attribution: { ...ATTRIBUTION, campaignName: null, adsetName: null, adName: null, platform: 'fb', isOrganic: true },
        intelligence: { ok: false, reason: 'provider-error' },
      }),
    )
    has(textOf(container), 'Came from an organic lead form (not an ad) · Facebook', 'The smart assistant isn’t available right now. Try again in a minute.')
  })

  test('expired subscription: the follow-up lock and the teaser follow the interface language', async () => {
    const { container } = render(await summaryTree('en', { hasAccess: false }, EXPIRED))
    const text = textOf(container)
    has(text, 'Follow-up: 10/30/2026', 'Renewing your subscription brings back scheduling follow-ups', 'Renew subscription', 'The smart summary analyzes the lead and suggests the next step.', 'View the summary')
    const lock = container.querySelector('[data-testid="subscription-expired-inline"]')!
    expect([lock.getAttribute('lang'), lock.getAttribute('dir')]).toEqual(['en', 'ltr'])
    expect(screen.getByLabelText('Smart summary, available with Pro')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View the summary' }))
    expect(H.proToasts.at(-1)).toMatchObject({ title: 'The smart summary is available with Pro', body: 'Renewing your subscription brings back the smart summary.' })
  })
})

describe('summary — Arabic', () => {
  test('chrome in Arabic, right-to-left, Latin digits', async () => {
    const { container } = render(await summaryTree('ar', { lead: { ...SUMMARY_LEAD, leadSource: 'facebook:1' } }))
    const text = textOf(container)
    has(
      text,
      'قيد المتابعة',
      'المتابعة التالية: 30/10/2026',
      'آخر تفاعل: تحدّثنا',
      'إرسال رسالة جاهزة',
      'ملخص ذكي',
      'ثقة متوسطة',
      'الإجراء الموصى به',
      'استنادًا إلى: حالة العميل المحتمل · النشاط الأخير',
      'وصلك هذا العميل المحتمل تلقائيًا من Facebook',
      'إجابات النموذج',
      'المدينة',
      'لم تتم الإجابة',
      'النشاط',
    )
    expect(text).not.toMatch(/[٠-٩]/)
    const root = container.querySelector('[data-edu="lead-status"]')!.closest('[lang]')!
    expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual(['ar', 'rtl'])
  })
})

describe('summary — Hebrew declares no region', () => {
  test('no lang/dir anywhere the legacy page had none', async () => {
    const { container } = render(await summaryTree('he', { lead: { ...SUMMARY_LEAD, leadSource: 'facebook:1' } }))
    expect(container.querySelector('[lang]')).toBeNull()
    // The inbound card has always declared rtl; nothing else declares a direction.
    expect(Array.from(container.querySelectorAll('[dir]')).map((e) => [e.tagName, e.getAttribute('dir')])).toEqual([['SECTION', 'rtl']])
  })
})

describe('hydration — server and client agree in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, build] of [
      ['layout', () => layoutTree(locale, { family: FAMILY })],
      ['summary', () => summaryTree(locale, { lead: { ...SUMMARY_LEAD, leadSource: 'facebook:1' }, attribution: ATTRIBUTION })],
      ['summary, expired', () => summaryTree(locale, { hasAccess: false }, EXPIRED)],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const tree = await build()
        const container = document.createElement('div')
        container.innerHTML = renderToString(tree)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => {
          root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) })
        })
        spy.mockRestore()
        expect(errors.map((e) => (Array.isArray(e) ? e.map(String).join(' ') : String(e)).slice(0, 400))).toEqual([])
        act(() => root!.unmount())
        container.remove()
      })
    }
  }
})
