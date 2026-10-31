// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { UiLocale } from '@/lib/i18n/config'
import { NOW, resetPhoneEnv, phoneEnv } from './phoneLeadsEnv'
import { actionCalls } from './phoneLeadsMocks'
import { phoneDetailPage, phoneLeadsPage, phoneShell } from './phoneLeadsHarness'

/**
 * Phone lead screens BEHAVIOUR in every language (i18n Phase F2): the same
 * taps (chosen by position, never by text) send identical arguments in he / en
 * / ar — status, follow-up, delete, the add form (stored gender / source /
 * status VALUES), the Excel import, the outcome, the detail delete — and the
 * touch-target classes and accessible names hold in every language.
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
const sheetButtons = () => [...dialog().querySelectorAll('button')].filter((b) => !b.getAttribute('aria-label'))
const rows = () => screen.getAllByTestId('lead-row')
const select = async (i: number) => {
  const el = rows()[i]
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  await act(async () => fireEvent.contextMenu(el))
}
const sticky = () => [...screen.getByTestId('leads-selection-bar').parentElement!.parentElement!.querySelectorAll('button.min-h-11')]

async function listFlow(locale: UiLocale) {
  resetPhoneEnv()
  phoneEnv.userLocale = locale
  const view = render(await phoneShell(locale, await phoneLeadsPage()))
  await select(0)
  const bar = [...document.querySelectorAll('button.press.min-h-11')]
  await click(bar[0]) // actions
  await click(sheetButtons()[0]) // change status
  await click(sheetButtons()[2]) // interested
  await click(bar[0])
  await click(sheetButtons()[1]) // follow-up
  fireEvent.change(dialog().querySelector('input[type="text"]')!, { target: { value: 'note' } })
  await click(sheetButtons()[1]) // tomorrow
  await click(rows()[1])
  await click([...document.querySelectorAll('button.bg-red-600')][0]) // delete
  await click(sheetButtons().at(-1)!.className.includes('red') ? sheetButtons().at(-1)! : sheetButtons()[0])
  // the add form: stored option values
  await click(screen.getByTestId('leads-add-action'))
  await click(sheetButtons()[0])
  const form = dialog().querySelector('form')!
  fireEvent.change(form.querySelector('[name="firstName"]')!, { target: { value: 'Dana' } })
  fireEvent.change(form.querySelector('[name="gender"]')!, { target: { value: 'נקבה' } })
  fireEvent.change(form.querySelector('[name="leadSource"]')!, { target: { value: 'המלצה' } })
  fireEvent.change(form.querySelector('[name="status"]')!, { target: { value: 'interested' } })
  const options = {
    gender: [...form.querySelectorAll('[name="gender"] option')].map((o) => (o as HTMLOptionElement).value),
    source: [...form.querySelectorAll('[name="leadSource"] option')].map((o) => (o as HTMLOptionElement).value),
    status: [...form.querySelectorAll('[name="status"] option')].map((o) => (o as HTMLOptionElement).value),
  }
  await act(async () => fireEvent.submit(form))
  view.unmount()
  return { calls: actionCalls().map((c) => (c[0] === 'setLeadFollowUp' ? [c[0], { ...(c[1] as object), at: 'AT' }] : c)), options }
}

async function importFlow(locale: UiLocale) {
  resetPhoneEnv()
  phoneEnv.userLocale = locale
  const view = render(await phoneShell(locale, await phoneLeadsPage()))
  await click(screen.getByTestId('leads-add-action'))
  await click(sheetButtons()[1])
  phoneEnv.results.uploadLeadData = { data: [{ firstName: 'דנה', phone: '0521111111' }], wrongData: [] }
  await act(async () => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.xlsx')] } }))
  await click(dialog().querySelector('button.bg-solid')!)
  view.unmount()
  return actionCalls()
}

async function detailFlow(locale: UiLocale) {
  resetPhoneEnv()
  phoneEnv.userLocale = locale
  const view = render(await phoneShell(locale, await phoneDetailPage()))
  const grid = [...document.querySelectorAll('.grid-cols-3 button')]
  await click(grid[2]) // outcome
  await click(sheetButtons()[1]) // reached
  await click(grid[0]) // status
  await click(sheetButtons()[4]) // lost
  await click(document.querySelector('button.mb-2')!) // overflow
  await click(sheetButtons().at(-1)!) // delete lead
  await click(sheetButtons().find((b) => b.className.includes('red'))!)
  view.unmount()
  return actionCalls()
}

describe('the same taps send the same arguments in every language', () => {
  test('list: status, follow-up, delete, the add form (stored values)', async () => {
    const he = await listFlow('he')
    expect(he.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['updateLead', 'setLeadFollowUp', 'deleteManyLeads', 'upsertLead']))
    const upsert = he.calls.find((c) => c[0] === 'upsertLead')![2] as Record<string, string>
    expect(upsert).toMatchObject({ firstName: 'Dana', gender: 'נקבה', leadSource: 'המלצה', status: 'interested' })
    expect(he.calls.find((c) => c[0] === 'updateLead')![1]).toEqual({ id: 11, status: 'interested' })
    expect(he.calls.find((c) => c[0] === 'deleteManyLeads')![1]).toEqual([11, 12])
    expect(he.options.status).toEqual(['new', 'contacted', 'interested', 'closed', 'lost'])
    expect(await listFlow('en')).toEqual(he)
    expect(await listFlow('ar')).toEqual(he)
  })

  test('import and the detail (outcome, status, delete)', async () => {
    const imp = await importFlow('he')
    expect(imp.map((c) => c[0])).toContain('addLeads')
    expect(await importFlow('en')).toEqual(imp)
    expect(await importFlow('ar')).toEqual(imp)
    const det = await detailFlow('he')
    expect(det.map((c) => c[0])).toEqual(['logLeadOutcome', 'updateLead', 'deleteLead'])
    expect(await detailFlow('en')).toEqual(det)
    expect(await detailFlow('ar')).toEqual(det)
  })
})

describe('touch targets and accessible names', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      phoneEnv.userLocale = locale
      render(await phoneShell(locale, await phoneLeadsPage()))
      const add = screen.getByTestId('leads-add-action')
      expect(add.className).toContain('size-11')
      expect(add.getAttribute('aria-label')).toBe(locale === 'en' ? 'Add lead' : 'إضافة عميل محتمل')
      for (const b of screen.getByRole('search').parentElement!.querySelectorAll('button')) {
        expect(b.getAttribute('aria-label') || b.textContent).toBeTruthy()
        expect(b.className).toMatch(/size-11|h-11/)
      }
      await select(0)
      for (const b of sticky()) expect(b.className).toContain('min-h-11')
    })
  }
})
