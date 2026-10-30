// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EXPIRED, NOW, resetPhoneEnv, phoneEnv } from './phoneLeadsEnv'
import { actionCalls, takeToasts } from './phoneLeadsMocks'
import { phoneDetailPage, phoneLeadsPage, phoneShell, setPhone } from './phoneLeadsHarness'

/**
 * HEBREW BASELINE, part 3 (i18n Phase F2): the phone add-lead form (fields,
 * "more details", ID validation, saving, the quota paywall, expired), the
 * phone import (file tab, paste tab, wrong file type, unreadable file, Excel
 * preview with rows needing review, every CSV summary, the bulk paywall), and
 * the phone lead DETAIL after acting (the three action buttons, the overflow
 * sheet, delete with every refusal, the outcome sheet with every toast, the
 * first-lead guidance). Recorded BEFORE Phase F2 on unmodified code, with NO
 * i18n provider. Normalized: React `useId` values only.
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

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const html = (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)
const click = async (el: Element) => act(async () => fireEvent.click(el))
const byText = (text: string) => screen.getAllByText(text).at(-1)!
const list = async (ent?: typeof EXPIRED) => render(await phoneShell(null, await phoneLeadsPage(), ent))
const detail = async (params: Record<string, string> = {}) => render(await phoneShell(null, await phoneDetailPage(params)))
const openAdd = async () => {
  await click(screen.getByTestId('leads-add-action'))
  await click(byText('הוסף ליד'))
}
const openImport = async () => {
  await click(screen.getByTestId('leads-add-action'))
  await click(byText('ייבוא לידים'))
}
const pick = async (name: string) =>
  act(async () => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], name)] } }))
const fill = (name: string, value: string) => fireEvent.change(document.querySelector(`[name="${name}"]`)!, { target: { value } })
const submit = async () => act(async () => fireEvent.submit(dialog()!.querySelector('form')!))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetPhoneEnv()
})

describe('Hebrew baseline — the phone add-lead form', () => {
  test('the form, ID refusals, a refused save, the quota paywall (single), success, expired', async () => {
    await list()
    const out: Record<string, unknown> = {}
    await openAdd()
    out.form = html(dialog())
    fill('firstName', 'דנה')
    fill('idNum', '123456789')
    phoneEnv.results.getLeadByIdNum = { name: 'יוסי אברהם' }
    await submit()
    out.idTaken = html(dialog()!.querySelector('[role="alert"]'))
    phoneEnv.results.getLeadByIdNum = null
    fill('idNum', '123456780')
    await submit()
    out.idInvalid = html(dialog()!.querySelector('[role="alert"]'))
    fill('idNum', '')
    phoneEnv.results.upsertLead = { err: true, msg: 'שגיאה בשמירת לקוח' }
    await submit()
    out.refused = html(dialog()!.querySelector('[role="alert"]'))
    phoneEnv.results.upsertLead = { error: 'quota_exceeded', current: 50, limit: 50, attempted: 1 }
    await submit()
    out.paywallSingle = html(dialog())
    await click(byText('מאוחר יותר'))
    phoneEnv.results.upsertLead = { id: 77 }
    await submit()
    out.toasts = takeToasts()
    out.calls = actionCalls()
    cleanup()
    await list(EXPIRED)
    await openAdd()
    out.expired = html(dialog())
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the phone import', () => {
  test('tabs, wrong file, unreadable file, Excel preview, CSV summaries, the bulk paywall', async () => {
    await list()
    const out: Record<string, unknown> = {}
    await openImport()
    out.fileTab = html(dialog())
    await click(byText('הדבקת מספרים'))
    out.pasteTab = html(dialog())
    await click(byText('קובץ'))
    await pick('notes.txt')
    out.wrongType = html(dialog()!.querySelector('[role="alert"]'))
    phoneEnv.results.uploadLeadData = 'throw'
    await pick('leads.xlsx')
    out.unreadable = html(dialog()!.querySelector('[role="alert"]'))
    phoneEnv.results.uploadLeadData = { error: 'הקובץ ריק' }
    await pick('leads.xlsx')
    out.serverError = html(dialog()!.querySelector('[role="alert"]'))
    phoneEnv.results.uploadLeadData = {
      data: [{ firstName: 'דנה', phone: '0521111111' }, { firstName: 'רון', phone: '0522222222' }],
      wrongData: [{ firstName: 'אבי', lastName: 'לוי', idNum: '12' }, { phone: 'x' }],
    }
    await pick('leads.xlsx')
    out.excelPreview = html(dialog())
    phoneEnv.results.addLeads = { error: 'quota_exceeded', current: 48, limit: 50, attempted: 2 }
    await click(byText('ייבא 2 לידים'))
    out.paywallBulk = html(dialog())
    await click(byText('מאוחר יותר'))
    phoneEnv.results.addLeads = 'throw'
    await click(byText('ייבא 2 לידים'))
    out.importFailed = html(dialog()!.querySelector('[role="alert"]'))
    phoneEnv.results.uploadLeadData = { data: [], wrongData: [{ phone: 'x' }] }
    await pick('leads.xlsx')
    out.nothingValid = html(dialog()!.querySelector('button.bg-solid'))
    for (const [name, result] of Object.entries({
      allNew: { inserted: 3, updated: 0, unchanged: 0, invalid: 0 },
      mixed: { inserted: 2, updated: 1, unchanged: 4, invalid: 2 },
      allExisting: { inserted: 0, updated: 0, unchanged: 5, invalid: 0 },
      none: { inserted: 0, updated: 0, unchanged: 0, invalid: 3 },
    })) {
      phoneEnv.results.importLeadsFromCsv = result
      await pick('leads.csv')
      out[`csv_${name}`] = html(dialog()!.querySelector('div.mt-5'))
    }
    out.calls = actionCalls()
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the phone lead detail after acting', () => {
  test('action buttons, overflow sheet, delete and every refusal, outcome sheet and its toasts, guidance', async () => {
    setPhone({ detail: { ...phoneEnv.detail!, nextFollowUpAt: null } })
    await detail({ firstLead: '1' })
    const out: Record<string, unknown> = {}
    out.actions = html(byText('סטטוס').closest('div.px-4'))
    await click(byText('פעולות'))
    out.overflow = html(dialog())
    await click(byText('מחיקת ליד'))
    out.confirm = html(dialog())
    for (const [name, result] of Object.entries({
      billing: { reason: 'has_billing', block: 'invoices' },
      noPermission: { reason: 'no_permission' },
      notFound: { reason: 'not_found' },
      thrown: 'throw',
      success: { success: true },
    })) {
      phoneEnv.results.deleteLead = result
      await click(byText('מחק ליד'))
      out[`delete_${name}`] = takeToasts()
    }
    await click(byText('תוצאה'))
    out.outcomeSheet = html(dialog())
    for (const [label, result] of [
      ['לא ענה', { nextFollowUpAt: '2026-11-02T07:00:00.000Z' }],
      ['לא ענה', {}],
      ['דיברנו', { nextFollowUpAt: '2026-11-02T07:00:00.000Z' }],
      ['דיברנו', {}],
      ['מעוניין', { nextFollowUpAt: '2026-11-02T07:00:00.000Z' }],
      ['מעוניין', {}],
      ['לא מעוניין', {}],
      ['לא מעוניין', { err: true, msg: 'אין הרשאה' }],
      ['לא ענה', 'throw'],
    ] as const) {
      phoneEnv.results.logLeadOutcome = result
      if (!dialog()) await click(byText('תוצאה'))
      await click(byText(label))
      out[`outcome_${label}_${typeof result === 'string' ? result : Object.keys(result).join('_')}`] = takeToasts()
    }
    await click(byText('קבע מתי לחזור אליו'))
    out.guidanceOpensFollowUp = html(dialog())
    out.calls = actionCalls()
    expect(out).toMatchSnapshot()
  })
})
