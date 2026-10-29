// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolveAsync } from './dashboardHarness'
import { NOW, STATS, VIEWER, dashboardEnv } from './dashboardFixtures'

/**
 * /dashboard in en / ar: content, direction, hydration, server-side producers,
 * and the guarantee that every OTHER consumer of the Today data keeps Hebrew.
 */

const prefs = { userLocale: 'en' as string | null }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard',
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
}))
vi.mock('@/db/auth', () => ({ getUser: async () => ({ id: 9001, name: 'דנה כהן', firstName: 'דנה', role: 'ADMIN', agencyId: 103 }) }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [] }) }))
vi.mock('@/db/clients', () => ({ hasAnyLeads: async () => true }))
vi.mock('@/db/worklist', async () => {
  const f = await import('./dashboardFixtures')
  return {
    getDueWorklist: async () => f.DUE_ROWS,
    getDueWorklistCount: async () => f.DUE_ROWS.length,
    getNewLeads: async () => f.NEW_LEADS,
    getNewLeadsCount: async () => f.NEW_LEADS.length,
    getDoneTodayCount: async () => 2,
  }
})
vi.mock('@/db/followUps', () => ({ getUpcomingFollowUpsCount: async () => 4 }))
vi.mock('@/db/inboxWaiting', async () => {
  const f = await import('./dashboardFixtures')
  return { listOldestWaitingWhatsappByLeadIds: async () => f.WAITERS, findOldestWaitingWhatsappConversation: async () => f.WAITERS[0] }
})
vi.mock('@/db/meetings', async () => ({ getTodaysMeetings: async () => (await import('./dashboardFixtures')).MEETINGS }))
vi.mock('@/db/today/facts', async () => ({ getBriefCandidateFacts: async () => (await import('./dashboardFixtures')).FACTS }))
vi.mock('@/db/today/handled', () => ({ getTouchedTodayIds: async () => [7, 8] }))
vi.mock('@/db/today/freshness', () => ({ getInboundSyncFreshness: async () => ({ dataFresh: true }) }))
vi.mock('@/db/facebook', () => ({ getFacebookConnectionState: async () => ({ connected: false }) }))
vi.mock('@/db/whatsapp', () => ({ getWhatsappConnectionState: async () => ({ connected: true }) }))
vi.mock('@/db/reports/dashboardStats', async () => ({ getDashboardStats: async () => (await import('./dashboardFixtures')).dashboardEnv.stats }))
vi.mock('@/lib/today/telemetry', () => ({ logBriefServed: () => {}, logBriefFailure: () => {} }))
vi.mock('@/lib/today/rollout', async () => {
  const f = await import('./dashboardFixtures')
  return { isTodayBriefEnabledForAgency: () => f.dashboardEnv.v2 }
})
vi.mock('@/lib/device', async () => {
  const f = await import('./dashboardFixtures')
  return { isMobileRequest: async () => f.dashboardEnv.mobile }
})
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: async () => ({}) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/modules/leads/contactLead', () => ({ contactLeadViaWhatsapp: () => {} }))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({ openLeadWhatsappInInbox: async () => {}, WHATSAPP_CONNECT_HREF: '/settings/integrations' }))
vi.mock('@/components/mobile/MobileHeaderAction', () => ({ useSetMobileHeaderAction: () => () => {} }))
vi.mock('@/modules/leads/mobile/LeadFormMobile', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadImportMobile', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadsAddSheet', () => ({ default: () => null }))

const { default: DashboardPage } = await import('@/components/home/DashboardPage')
const { I18nProvider } = await import('@/lib/i18n/I18nProvider')

async function pageTree(locale: 'he' | 'en' | 'ar', env: Partial<typeof dashboardEnv>) {
  prefs.userLocale = locale
  Object.assign(dashboardEnv, { mobile: false, v2: true, stats: STATS }, env)
  const page = await resolveAsync(await DashboardPage({ searchParams: Promise.resolve({}) }))
  return <I18nProvider locale={locale}>{page}</I18nProvider>
}

function textOf(html: string) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

// Without this React reports every client update during hydration as an
// "environment does not support act" console error, which would mask (or fake)
// real hydration errors.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const savedEnv = { ...process.env }
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, {
    UI_LOCALE_ENABLED: '1',
    UI_LOCALE_AGENCY_ALLOWLIST: '103',
    MOBILE_WORKSPACE_ENABLED: '1',
    MOBILE_WORKSPACE_AGENCY_ALLOWLIST: '103',
  })
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => Object.assign(dashboardEnv, { mobile: false, v2: true, stats: STATS }))

describe('desktop Today brief v2', () => {
  test('English: greeting, date, hero, mission, list, meetings, analytics', async () => {
    const text = textOf(renderToString(await pageTree('en', {})))
    for (const s of [
      'Wednesday, October 28',
      'Good morning, דנה',
      '6 leads need you today',
      'Next task',
      'Waiting 3 hours',
      '21 hours left in the WhatsApp window',
      'Needs attention now',
      'Follow-up overdue',
      'Follow-up due today',
      'New lead',
      'Task overdue',
      'Waiting for action',
      "Today's meetings",
      'Sarah Miller · Video meeting',
      '14:00',
      'Meeting',
      'New leads',
      'In the last 14 days',
      'Revenue in 14 days',
      '3 deals paid',
      'Lead sources',
      'Facebook / Instagram',
      'Sales funnel',
      'Close rate 63%',
      'In progress',
      'Lost: 3',
      '7 days',
    ])
      expect(text, s).toContain(s)
  })

  test('Arabic: formal terms, six-form plurals, Latin digits', async () => {
    const text = textOf(renderToString(await pageTree('ar', {})))
    for (const s of ['صباح الخير، דנה', '6 عملاء محتملين بحاجة إليك اليوم', 'المهمة التالية', 'بالانتظار منذ 3 ساعات', 'مسار المبيعات', 'اجتماعات اليوم'])
      expect(text, s).toContain(s)
    expect(text).not.toMatch(/[٠-٩]/)
  })

  test('the dashboard is a language region: lang/dir on its root, nothing for Hebrew', async () => {
    const rootOf = (html: string) => {
      const div = document.createElement('div')
      div.innerHTML = html
      return div.firstElementChild!
    }
    for (const [locale, dir] of [['en', 'ltr'], ['ar', 'rtl']] as const) {
      for (const env of [{}, { v2: false }, { mobile: true }]) {
        const root = rootOf(renderToString(await pageTree(locale, env)))
        expect([root.getAttribute('lang'), root.getAttribute('dir')], JSON.stringify(env)).toEqual([locale, dir])
      }
    }
    // Hebrew: the root declares nothing (inner, pre-existing dir="ltr" on the
    // chart canvas and KPI deltas are unrelated and unchanged).
    for (const env of [{}, { v2: false }, { mobile: true }]) {
      const root = rootOf(renderToString(await pageTree('he', env)))
      expect([root.hasAttribute('lang'), root.hasAttribute('dir')], JSON.stringify(env)).toEqual([false, false])
    }
  })
})

describe('other variants', () => {
  test('legacy worklist in English, including pagination-free follow-ups and quick links', async () => {
    const text = textOf(renderToString(await pageTree('en', { v2: false })))
    for (const s of ['Today', '2 handled', '3 remaining', 'Needs attention now', 'Follow-ups', 'All follow-ups', 'Upcoming follow-ups', "Today's meetings"])
      expect(text, s).toContain(s)
  })

  test('analytics unavailable in Arabic', async () => {
    const text = textOf(renderToString(await pageTree('ar', { stats: null })))
    expect(text).toContain('تعذّر تحميل بيانات الأداء حاليًا')
    expect(text).toContain('إعادة تحميل البيانات')
  })

  test('mobile Today in English', async () => {
    const text = textOf(renderToString(await pageTree('en', { mobile: true })))
    for (const s of ['Needs attention now', '6 waiting', 'Waiting 3 hours', 'Up next', 'Follow-up overdue']) expect(text, s).toContain(s)
  })
})

describe('hydration: server HTML and the client agree in every locale and variant', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, env] of [
      ['v2', {}],
      ['legacy', { v2: false }],
      ['mobile', { mobile: true }],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const tree = await pageTree(locale, env)
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
        expect(errors).toEqual([])
        act(() => root!.unmount())
        container.remove()
      })
    }
  }
})

describe('server-side producers', () => {
  test('durations: Arabic uses every plural form; English singular/plural; Hebrew unchanged', async () => {
    const { formatCoarseDuration } = await import('@/lib/inbox/waitingReplyCopy')
    const M = 60_000
    expect([1, 2, 3, 11, 59].map((m) => formatCoarseDuration(m * M, 'ar'))).toEqual(['دقيقة', 'دقيقتان', '3 دقائق', '11 دقيقة', '59 دقيقة'])
    expect([1, 2].map((h) => formatCoarseDuration(h * 60 * M, 'en'))).toEqual(['1 hour', '2 hours'])
    expect(formatCoarseDuration(20_000, 'en')).toBe('under a minute')
    expect(formatCoarseDuration(2 * 24 * 60 * M, 'he')).toBe('2 ימים')
  })

  test('WhatsApp window copy carries a code, and the closed text follows the locale', async () => {
    const { waitingReplyCopy } = await import('@/lib/inbox/waitingReplyCopy')
    const closed = waitingReplyCopy({ lastInboundAt: NOW - 30 * 3_600_000, lastHumanOutboundAt: null, nowMs: NOW, channel: 'whatsapp', locale: 'en' })
    expect(closed).toMatchObject({ window: 'CLOSED', windowHint: 'WhatsApp window closed', waitingFor: 'Waiting 1 day' })
  })

  test('greeting buckets and dates follow the business timezone, not the server zone', async () => {
    const { greetingFor } = await import('@/lib/today/greeting')
    const { BUSINESS_TZ } = await import('@/lib/today/constants')
    expect(greetingFor(Date.parse('2026-10-28T03:30:00Z'), BUSINESS_TZ, 'en')).toBe('Good morning') // 05:30 local
    expect(greetingFor(Date.parse('2026-10-28T02:30:00Z'), BUSINESS_TZ, 'ar')).toBe('مساء الخير') // 04:30 local
    const { dayLabels } = await import('@/lib/dashboard/stats')
    expect(dayLabels('2026-10-25', 'en')).toEqual({ short: '10/25', long: 'Sun · 10/25' })
    expect(dayLabels('2026-10-25', 'he')).toEqual({ short: '25.10', long: 'יום א׳ · 25.10' })
  })

  test('source labels translate; an unknown source is external data, returned verbatim', async () => {
    const { leadSourceLabel } = await import('@/lib/leads/leadSourceLabel')
    expect(leadSourceLabel('contact_form_7:x', 'en')).toBe('Website')
    expect(leadSourceLabel(null, 'ar')).toBe('يدوي')
    expect(leadSourceLabel('קמפיין סתיו', 'en')).toBe('קמפיין סתיו')
  })

  test('tone from codes equals the legacy Hebrew-text tone for every reason and window state', async () => {
    const { toneForReason, toneForWindow, todayReasonTone, todayWindowHintTone } = await import('@/modules/today/mobile/reasonTone')
    const { reasonLabel } = await import('@/lib/today/labels')
    const codes = ['WAITING_REPLY', 'FOLLOWUP_OVERDUE', 'FOLLOWUP_DUE_TODAY', 'NEW_INBOUND', 'OVERDUE_TASK', 'OPEN_LOOP_SLA', 'NEW_INBOUND_TODAY', 'NO_ANSWER_LAST'] as const
    for (const code of codes) expect(toneForReason(code), code).toBe(todayReasonTone(reasonLabel(code)))
    expect(toneForWindow('CLOSED')).toBe(todayWindowHintTone('חלון WhatsApp נסגר'))
    expect(toneForWindow('OPEN')).toBe(todayWindowHintTone('נותרו 17 שעות בחלון WhatsApp'))
    // English/Arabic text never matches the legacy patterns — logic must come from codes.
    for (const code of codes) expect(todayReasonTone(reasonLabel(code, 'en'))).toBeNull()
  })
})

describe('every other consumer of the Today data keeps Hebrew', () => {
  test('buildTodayBrief without a locale is the Hebrew brief', async () => {
    const { buildTodayBrief } = await import('@/lib/today/service')
    const plain = await buildTodayBrief(VIEWER, NOW)
    expect(plain).toEqual(await buildTodayBrief(VIEWER, NOW, { locale: 'he' }))
    expect(plain.items[0].reason).toBe('ממתין לתשובה שלך')
    expect(plain.greeting).toBe('בוקר טוב')
  })

  test('MCP tool, AI agent tool and mobile API call buildTodayBrief without a locale', () => {
    for (const file of ['lib/mcp/tools/getTodayBrief.ts', 'lib/agent/tools/getTodayState.ts', 'app/api/mobile/v1/today/route.ts']) {
      const src = readFileSync(file, 'utf8')
      const call = src.slice(src.indexOf('buildTodayBrief('), src.indexOf('buildTodayBrief(') + 400)
      expect(call, file).not.toMatch(/locale/)
    }
  })
})
