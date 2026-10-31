// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { expectStickyEdges } from './stickyActionsEdge'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, render } from '@testing-library/react'
import { NOW, ROWS } from './leadsFixtures'
import { FAILING_INTAKE, LEADS_DEFAULTS, leadsEnv, resetLeadsEnv } from './leadsEnv'

/**
 * /leads and /clients in en / ar (Phase C): content, region direction,
 * hydration. Behaviour under a translated UI is in leadsBehaviour.test.tsx.
 */

const prefs = { userLocale: 'en' as string | null }

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
}))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./leadsHarness')).LEADS_USER }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/filter', async () => ({ getPerms: async () => (await import('./leadsEnv')).LEADS_PAGE_PERMS }))
vi.mock('@/db/clients', async () => {
  const { leadsEnv, CLIENT_LISTS } = await import('./leadsEnv')
  return {
    hasAnyLeads: async () => leadsEnv.hasLeads,
    getLeadLists: async () => CLIENT_LISTS,
    getLeadsTable: async () => leadsEnv.rows,
    getGlobalLatestUpdatedAt: async () => '2026-10-28T09:00:00.000Z',
    getLeadColumnAvailability: async () => ({ idNum: true, secPhone: true, birthDate: true, gender: true }),
  }
})
vi.mock('@/db/facebook', async () => ({ getFacebookConnectionState: async () => (await import('./leadsEnv')).leadsEnv.meta }))
vi.mock('@/db/whatsapp', () => ({ getWhatsappConnectionState: async () => ({ connected: true }) }))
vi.mock('@/db/usersNTeams', async () => ({ getDefaultSettings: async () => ({}), getUsers: async () => (await import('./leadsEnv')).USERS }))
vi.mock('@/lib/quota', async () => ({ getQuotaStatus: async () => ({ overQuotaCount: (await import('./leadsEnv')).leadsEnv.overQuota }) }))
vi.mock('@/db/automations/connectionDelivery', async () => ({ deliveryFacts: async () => (await import('./leadsEnv')).leadsEnv.intakeFacts }))
vi.mock('@/actions/clients', () => ({ fetchLeadsSince: async () => [], searchContacts: async () => [], searchLeads: async () => [] }))
vi.mock('@/actions/global', () => ({ saveTblPref: async () => ({ ok: true }) }))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: async () => [] }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))

const { leadsPage, clientsPage, shell } = await import('./leadsHarness')

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
  resetLeadsEnv()
})

type Loc = 'he' | 'en' | 'ar'
const BANNERS = { meta: { connected: true, needsReconnect: true }, intakeFacts: FAILING_INTAKE }

async function leadsTree(locale: Loc, overrides: Partial<typeof LEADS_DEFAULTS> = {}, params: Record<string, string> = {}) {
  prefs.userLocale = locale
  Object.assign(leadsEnv, LEADS_DEFAULTS, overrides)
  return shell(locale, await leadsPage(params))
}

const textOf = (el: Element) => el.textContent ?? ''

describe('/leads — English', () => {
  test('table, tabs, cells, toolbar, footer and every banner', async () => {
    const { container } = render(await leadsTree('en', BANNERS, { firstImport: '24', firstLeadId: '5', firstImportSkipped: '3' }))
    const text = textOf(container)
    for (const s of [
      'New', 'In progress', 'Interested', 'Closed', 'Lost',
      'Full name', 'Phone number', 'Status', 'Next action', 'Source', 'Email', 'Lead status', 'Last contact', 'Actions',
      'Call now', 'Today', 'Yesterday', '5 days ago', 'WhatsApp', 'Facebook', 'Instagram',
      'New lead', 'Sort: most urgent', 'Sort: newest', 'Visible columns', 'Lists',
      '8 records', 'Previous', 'Next',
      "Your Meta account is disconnected. New leads won't come in until you reconnect it.", 'Reconnect',
      "There's a problem with your website form connection", "Form submissions arrive but don't enter the system.",
      'You have 13 new leads waiting — upgrade to see them', 'Upgrade now',
      '24 leads are in', "3 lines in the file couldn't be read and weren't added", 'Open the first lead',
    ]) expect(text, s).toContain(s)
    // Customer data is untouched.
    for (const name of ['דנה כהן', 'יוסי לוי', 'מיכל אברהם']) expect(text).toContain(name)
    expect(container.querySelector('tbody button[aria-label="Actions"]')).not.toBeNull()
    expect(container.querySelector('a[aria-label="Clear search"]')).not.toBeNull()
  })

  test('the page root, status tabs and banners declare English left-to-right', async () => {
    const { container } = render(await leadsTree('en', BANNERS, { firstImport: '2' }))
    const table = container.querySelector('[data-edu="leads-table"]')!
    expect(table.closest('[lang]')?.getAttribute('lang')).toBe('en')
    expect(table.closest('[dir]')?.getAttribute('dir')).toBe('ltr')
    expect(container.querySelector('[data-edu="lead-status-tabs"]')!.getAttribute('dir')).toBe('ltr')
    expect(container.querySelector('[role="status"][dir]')!.getAttribute('lang')).toBe('en')
  })

  test('/clients: explainer, new-customer button, customer badge and status option', async () => {
    prefs.userLocale = 'en'
    Object.assign(leadsEnv, LEADS_DEFAULTS, { rows: ROWS.filter((r) => r.lead === false) })
    const { container } = render(await shell('en', await clientsPage()))
    const text = textOf(container)
    for (const s of ['Customers are leads that closed a deal', 'New customer', 'Customer', 'Delete', 'Full name']) expect(text).toContain(s)
    const options = Array.from(container.querySelectorAll('tbody select option')).map((o) => [o.getAttribute('value'), o.textContent])
    expect(options).toContainEqual(['new', 'Customer'])
    expect(options).toContainEqual(['closed', 'Closed'])
  })
})

describe('/leads — Arabic', () => {
  test('content with Arabic plurals and Latin digits, right-to-left', async () => {
    const { container } = render(await leadsTree('ar', BANNERS, { firstImport: '24', firstLeadId: '5', firstImportSkipped: '3' }))
    const text = textOf(container)
    for (const s of [
      'جديد', 'قيد المتابعة', 'مهتم', 'مُغلق', 'خاسر', 'الاسم الكامل', 'الإجراء التالي', 'اتصل الآن',
      'اليوم', 'أمس', 'قبل 5 أيام', '8 سجلات', 'عميل محتمل جديد', 'السابق', 'التالي',
      'دخل 24 عميلًا محتملًا', 'تعذّرت قراءة 3 أسطر في الملف ولم تُضف',
      'لديك 13 عميلًا محتملًا جديدًا بانتظارك — قم بالترقية لرؤيتهم',
      'توجد مشكلة في الربط مع نموذج موقعك',
    ]) expect(text, s).toContain(s)
    const table = container.querySelector('[data-edu="leads-table"]')!
    expect(table.closest('[lang]')?.getAttribute('lang')).toBe('ar')
    expect(table.closest('[dir]')?.getAttribute('dir')).toBe('rtl')
  })
})

describe('/leads — Hebrew is unchanged and declares nothing', () => {
  test('no lang attribute anywhere on the page; tabs keep dir=rtl', async () => {
    const { container } = render(await leadsTree('he', BANNERS, { firstImport: '2' }))
    expect(container.querySelector('[lang]')).toBeNull()
    expect(container.querySelector('[data-edu="lead-status-tabs"]')!.getAttribute('dir')).toBe('rtl')
    expect(textOf(container)).toContain('חשבון ה‑Meta מנותק')
  })
})

describe('first run', () => {
  test('desktop empty workspace in English and Arabic', async () => {
    const en = render(await leadsTree('en', { hasLeads: false }))
    for (const s of ["Your workspace is open — now let's bring in your leads", 'Bring in the leads you already have', 'Your list, organized', 'Fastest', 'Add a single lead', 'Connect the source your leads come from', 'Facebook & Instagram']) {
      expect(textOf(en.container)).toContain(s)
    }
    expect(en.container.querySelector('[data-leads-empty]')!.getAttribute('lang')).toBe('en')
    en.unmount()
    const ar = render(await leadsTree('ar', { hasLeads: false }))
    expect(textOf(ar.container)).toContain('مساحة عملك مفتوحة، والآن لنُدخل عملاءك المحتملين')
    expect(ar.container.querySelector('[data-leads-empty]')!.getAttribute('dir')).toBe('rtl')
  })
})

describe('hydration — server and client agree in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, overrides] of [
      ['table + banners', BANNERS],
      ['first run', { hasLeads: false }],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const tree = await leadsTree(locale, overrides, { firstImport: '3', firstLeadId: '5' })
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
        // Stringified so a failure says WHAT React reported.
        expect(errors.map((e) => (Array.isArray(e) ? e.map(String).join(' ') : String(e)).slice(0, 400))).toEqual([])
        act(() => root!.unmount())
        container.remove()
      })
    }
  }
})

describe('the actions column pins to the end of the row (final UI audit)', () => {
  test('he / ar pinned left as before, en pinned right', async () => {
    const seen = {} as Record<'he' | 'en' | 'ar', HTMLElement>
    for (const l of ['he', 'en', 'ar'] as const) {
      const { container } = render(await leadsTree(l))
      seen[l] = container.cloneNode(true) as HTMLElement
      cleanup()
    }
    expectStickyEdges(seen)
  })
})
