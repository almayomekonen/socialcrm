// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import type { UiLocale } from '@/lib/i18n/config'
import { DETAIL, NOW, SOURCE_DETAILS, resetPhoneEnv, phoneEnv } from './phoneLeadsEnv'
import { takeToasts } from './phoneLeadsMocks'
import { phoneDetailPage, phoneLeadsPage, phoneShell, setPhone } from './phoneLeadsHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * The phone lead screens in English and Arabic (i18n Phase F2): the REAL
 * `/leads` and `/clients/[id]/summary` pages on a phone — list, cards,
 * filters, empty states, detail, provenance, the sheets and their toasts,
 * validation — region lang/dir, nothing declared Hebrew except data and AI
 * output, hydration in he / en / ar and a language switch in one session.
 * Hebrew byte-identity is the baselines' job (phoneLeadsHebrewBaseline*).
 */

vi.mock('next/navigation', async () => (await import('./phoneLeadsMocks')).navigationModule())
vi.mock('next/server', async () => (await import('./phoneLeadsMocks')).serverModule())
vi.mock('@/lib/analytics/track', () => ({ track: async () => {} }))
vi.mock('@/db/auth', async () => (await import('./phoneLeadsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => {
  const { PHONE_USER } = await import('./phoneLeadsEnv')
  return { requireAgencyUser: async () => PHONE_USER, requireBasicCrmAccess: async () => PHONE_USER }
})
vi.mock('@/db/uiLocale', async () => (await import('./phoneLeadsMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./phoneLeadsMocks')).deviceModule())
vi.mock('@/lib/flags/mobileFlags', () => ({ canEnterMobileWorkspace: () => true }))
vi.mock('@/modules/leads/queries', async () => (await import('./phoneLeadsMocks')).queriesModule())
vi.mock('@/db/whatsapp', async () => (await import('./phoneLeadsMocks')).whatsappDbModule())
vi.mock('@/db/facebook', async () => (await import('./phoneLeadsMocks')).facebookDbModule())
vi.mock('@/modules/inbox/queries', async () => (await import('./phoneLeadsMocks')).inboxQueriesModule())
vi.mock('@/db/inboxMessages', async () => (await import('./phoneLeadsMocks')).inboxMessagesModule())
vi.mock('@/db/leadFormAnswers', async () => (await import('./phoneLeadsMocks')).formAnswersModule())
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))
vi.mock('@/actions/ai/leadIntelligence', async () => (await import('./phoneLeadsMocks')).intelligenceModule())
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: true }) }))
vi.mock('@/actions/clients', async () => (await import('./phoneLeadsMocks')).clientsActionsModule())
vi.mock('@/actions/leads/loadMoreMobileLeads', async () => (await import('./phoneLeadsMocks')).loadMoreModule())
vi.mock('@/actions/leadFollowUp', async () => (await import('./phoneLeadsMocks')).followUpModule())
vi.mock('@/actions/leadOutcome', async () => (await import('./phoneLeadsMocks')).outcomeModule())
vi.mock('@/actions/leadDuplicates', async () => (await import('./phoneLeadsMocks')).duplicatesModule())
vi.mock('@/modules/inbox/actions', async () => (await import('./phoneLeadsMocks')).inboxActionsModule())
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))
vi.mock('@/lib/toast', async () => (await import('./phoneLeadsMocks')).toastModule())

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const saved = { ...process.env }
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
})
afterEach(() => {
  cleanup()
  process.env = { ...saved }
  resetPhoneEnv()
})

const dialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)!
const click = async (el: Element) => act(async () => fireEvent.click(el))
const rows = () => screen.getAllByTestId('lead-row')
const select = async (i: number) => {
  const el = rows()[i]
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  await act(async () => fireEvent.contextMenu(el))
}
const list = async (locale: UiLocale, params: Record<string, string> = {}) => {
  phoneEnv.userLocale = locale
  return render(await phoneShell(locale, await phoneLeadsPage(params)))
}
const detail = async (locale: UiLocale, params: Record<string, string> = {}) => {
  phoneEnv.userLocale = locale
  return render(await phoneShell(locale, await phoneDetailPage(params)))
}
/** The open (portalled) sheet renders no untranslated Hebrew; `data` = fixture values shown verbatim. */
const noLeaks = (...data: string[]) =>
  expect(findHebrewLeaks(dialog(), data.map((text) => ({ text, reason: 'customer-data' as const })))).toEqual([])
/** Every element that declares Hebrew, as its text. */
const hebrewIslands = (root: Element) => [...root.querySelectorAll('[lang="he"]')].map((e) => e.textContent)

describe('the phone lead list', () => {
  test('English: cards, statuses, badges, recency, next steps, filter bar, load more, region', async () => {
    setPhone({ hasMore: true })
    const { container } = await list('en', { q: 'יוסי', status: 'new' })
    const root = container.querySelector('[lang="en"]')!
    expect(root.getAttribute('dir')).toBe('ltr')
    const text = container.textContent!
    for (const s of ['New', 'In progress', 'Interested', 'Follow-up overdue', 'Follow-up today', 'Waiting a long time', 'Call now', 'Load more', '6 leads', 'Clear all'])
      expect(text, s).toContain(s)
    expect(text).toMatch(/now|second|minutes? ago/)
    expect(screen.getByPlaceholderText('Search by name or phone')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter by status, 1 selected' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove New' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add lead' })).toBeTruthy()
    expect(hebrewIslands(container)).toEqual([])
    await click(screen.getByRole('button', { name: 'Filter by status, 1 selected' }))
    expect(dialog().textContent).toContain('All statuses')
    noLeaks()
    await click(screen.getByRole('button', { name: 'Close' }))
    await click(screen.getByTestId('leads-add-action'))
    noLeaks()
  })

  test('Arabic: labels, plural count, filtered empty', async () => {
    const { container } = await list('ar')
    expect(container.querySelector('[lang="ar"]')!.getAttribute('dir')).toBe('rtl')
    expect(container.textContent).toContain('متابعة متأخرة')
    expect(container.textContent).toContain('6 عملاء محتملين')
    cleanup()
    setPhone({ rows: [] })
    await list('ar', { q: 'דנה' })
    expect(screen.getByText('لا توجد نتائج لـ "דנה".')).toBeTruthy()
    expect(screen.getByText('مسح التصفية')).toBeTruthy()
  })

  test('the empty workspace mirrors its forward chevrons in English only', async () => {
    setPhone({ workspaceHasLeads: false })
    const { container } = await list('en')
    const chevrons = (root: Element) => [...root.querySelectorAll('[class*="size-4 bg-gray-300"]')]
    expect(chevrons(container).length).toBe(3)
    for (const c of chevrons(container)) expect(c.className).toContain('-scale-x-100')
    cleanup()
    const ar = await list('ar')
    expect(chevrons(ar.container).length).toBe(3)
    for (const c of chevrons(ar.container)) expect(c.className).not.toContain('-scale-x-100')
  })
})

describe('the phone list sheets and their toasts', () => {
  test('English: selection, actions sheet, status, follow-up, delete confirmation, toasts', async () => {
    await list('en')
    await select(0)
    expect(screen.getByTestId('leads-selection-bar').textContent).toContain('1')
    await click(screen.getByText('Actions'))
    expect(dialog().getAttribute('lang')).toBe('en')
    expect(dialog().textContent).toContain('Lead actions')
    noLeaks()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    await click(screen.getByText('Change status'))
    noLeaks()
    await click(screen.getAllByText('In progress').at(-1)!)
    expect(takeToasts()).toEqual([['toast', 'success', 'Status updated']])
    await click(screen.getByText('Actions'))
    await click(screen.getByText('Add follow-up'))
    expect(dialog().textContent).toContain('Follow-up')
    expect(screen.getByPlaceholderText('Note (optional)')).toBeTruthy()
    noLeaks()
    await click(screen.getByText('Tomorrow'))
    expect(takeToasts()[0][2]).toMatch(/^Follow-up scheduled for /)
    await click(rows()[1])
    await click(screen.getByText('Delete'))
    expect(dialog().textContent).toContain('Delete 2 leads?')
    noLeaks()
    phoneEnv.results.deleteManyLeads = 'throw'
    await click(screen.getAllByText('Delete leads').at(-1)!)
    expect(takeToasts()).toEqual([['toast', 'error', "We couldn't delete the leads"]])
  })

  test('Arabic: the two-lead confirmation and Escape returns the sheet', async () => {
    await list('ar')
    await select(0)
    await click(rows()[1])
    await click(screen.getByText('حذف'))
    expect(dialog().textContent).toContain('هل تريد حذف عميلين محتملين؟')
    noLeaks()
    await act(async () => fireEvent.keyDown(dialog(), { key: 'Escape' }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('the add form, import and paywall', () => {
  test('English: fields, ID validation, paywall, import preview and summary', async () => {
    await list('en')
    await click(screen.getByTestId('leads-add-action'))
    await click(screen.getByText('Add lead', { selector: 'button' }))
    for (const s of ['First name', 'Last name', 'More details']) expect(dialog().textContent).toContain(s)
    noLeaks()
    fireEvent.change(document.querySelector('[name="idNum"]')!, { target: { value: '123456780' } })
    await act(async () => fireEvent.submit(dialog().querySelector('form')!))
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe('Invalid ID number')
    fireEvent.change(document.querySelector('[name="idNum"]')!, { target: { value: '' } })
    phoneEnv.results.upsertLead = { error: 'quota_exceeded', current: 50, limit: 50, attempted: 1 }
    await act(async () => fireEvent.submit(dialog().querySelector('form')!))
    expect(dialog().textContent).toContain('Pro')
    expect(dialog().textContent).toMatch(/a year/)
    noLeaks()
    expect(dialog().getAttribute('lang')).toBe('en')
  })

  test('Arabic: the import sheet, preview plurals, CSV summary', async () => {
    await list('ar')
    await click(screen.getByTestId('leads-add-action'))
    await click(screen.getByText('استيراد العملاء المحتملين'))
    expect(dialog().textContent).toContain('الصف الأول')
    noLeaks()
    await click([...dialog().querySelectorAll('[role="tab"]')][1]) // the paste tab
    noLeaks()
    await click([...dialog().querySelectorAll('[role="tab"]')][0])
    phoneEnv.results.uploadLeadData = { data: [{ firstName: 'דנה' }, { firstName: 'רון' }], wrongData: [{}] }
    await act(async () => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.xlsx')] } }))
    expect(dialog().textContent).toContain('وجدنا 3 عملاء محتملين')
    expect(dialog().textContent).toContain('استيراد عميلين محتملين')
    expect(dialog().textContent).toContain('صف غير صالح')
    noLeaks('דנה', 'רון')
  })
})

describe('the phone lead detail', () => {
  test('English: chips, info rows, contact, provenance, actions, AI output stays in its Hebrew region', async () => {
    setPhone({ detail: { ...DETAIL, ...SOURCE_DETAILS.facebook }, formAnswers: [{ key: 'city', values: ['חיפה'] }] })
    const { container } = await detail('en', { firstLead: '1' })
    const text = container.textContent!
    for (const s of ['In progress', 'Follow-up overdue', 'Last outcome', 'We talked', 'Last activity', 'Phone', 'Email', 'Outcome', 'Actions'])
      expect(text, s).toContain(s)
    expect(text).toContain('This lead reached you automatically from Facebook')
    expect(text).toContain('Captured automatically: ')
    expect(text).toContain('City')
    const islands = hebrewIslands(container).join(' | ')
    expect(islands).toContain('הליד ביקש הצעת מחיר')
    expect(container.querySelector('[data-testid="lead-provenance-mobile"]')!.getAttribute('dir')).toBe('ltr')
  })

  test('Arabic: not found, outcome toast', async () => {
    setPhone({ detail: null })
    const { container } = await detail('ar')
    expect(container.textContent).toContain('لم يتم العثور')
    cleanup()
    setPhone({ detail: DETAIL })
    await detail('ar')
    await click(screen.getByText('إجراءات', { selector: 'button' }))
    noLeaks()
    await click(screen.getByRole('button', { name: 'إغلاق' }))
    await click(screen.getByText('النتيجة'))
    noLeaks()
    await click(screen.getAllByText(/./).find((e) => e.tagName === 'BUTTON' && dialog().contains(e))!)
    expect(takeToasts()[0][1]).toBe('success')
  })
})

describe('hydration and a language switch', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`the list and the detail hydrate without a mismatch (${locale})`, async () => {
      const errors: unknown[] = []
      // Only hydration disagreements count (Next's Link schedules unrelated non-act updates in jsdom).
      vi.mocked(console.error).mockImplementation((...a) => {
        if (/hydrat|did not match|server rendered/i.test(String(a[0]))) errors.push(a)
      })
      phoneEnv.userLocale = locale
      for (const build of [() => phoneLeadsPage(), () => phoneDetailPage()]) {
        const tree = await phoneShell(locale, await build())
        const host = document.createElement('div')
        host.innerHTML = renderToString(tree)
        document.body.appendChild(host)
        await act(async () => {
          hydrateRoot(host, tree, { onRecoverableError: (e) => errors.push(e) })
        })
        host.remove()
      }
      expect(errors).toEqual([])
    })
  }

  test('switching he → en → ar in one session re-words the list', async () => {
    const { rerender } = await list('he')
    expect(screen.getAllByText('מעקב באיחור').length).toBeGreaterThan(0)
    for (const [locale, word] of [['en', 'Follow-up overdue'], ['ar', 'متابعة متأخرة']] as const) {
      phoneEnv.userLocale = locale
      rerender(await phoneShell(locale, await phoneLeadsPage()))
      expect(screen.getAllByText(word).length).toBeGreaterThan(0)
    }
  })
})
