// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CHANNEL, NOW, QUOTE_DOCUMENTS, resetAdminEnv, adminEnv } from './adminEnv'
import { EXPIRED, adminPage, adminShell, type AdminPage } from './adminHarness'

/**
 * HEBREW BASELINE — quote templates and auto-response interactions (Phase
 * E5a), plus a JSON snapshot of their label producers. Recorded BEFORE Phase
 * E5 on unmodified product code, with each action's arguments.
 */

vi.mock('next/navigation', async () => (await import('./adminMocks')).navigationModule('/settings/quote-templates'))
vi.mock('@/lib/toast', async () => (await import('./adminMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./adminMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./adminMocks')).deviceModule())
vi.mock('@/lib/access/productAccess', async () => (await import('./adminMocks')).productAccessModule())
vi.mock('@/config/db', async () => (await import('./adminMocks')).configDbModule())
vi.mock('@/db/quotes/templateWrites', async () => (await import('./adminMocks')).quoteWritesDbModule())
vi.mock('@/actions/quotes/templates', async () => (await import('./adminMocks')).quoteActionsModule())
vi.mock('@/db/autoResponseSettings', async () => (await import('./adminMocks')).autoResponseDbModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./adminMocks')).builderFlagsModule())
vi.mock('@/actions/autoResponse/updateSettings', async () => (await import('./adminMocks')).updateAutoResponseModule())
vi.mock('@/actions/autoResponse/previewAgent', async () => (await import('./adminMocks')).previewAgentModule())
vi.mock('@/modules/settings/mobile/AutoResponseMobile', async () => (await import('./adminMocks')).autoResponseMobileModule())

const norm = (html: string) => html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const set = (overrides: Partial<typeof adminEnv>) => Object.assign(adminEnv, overrides)
const calls = () => JSON.parse(JSON.stringify(adminEnv.calls))
const dialogs = () => norm([...document.querySelectorAll('[role="dialog"]')].map((d) => d.outerHTML).join('\n'))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const btn = (text: string) => screen.getAllByText(text).pop()!.closest('button')
const type = (el: Element | null, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const mount = async (name: AdminPage, ent?: typeof EXPIRED) => render(await adminShell(null, await adminPage(name), ent))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {}, scrollIntoView() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAdminEnv()
})

describe('Hebrew baseline — quote templates', () => {
  test('new sheet (validation, every save refusal, success), edit sheet, lines, archive confirm, restore, refusals', async () => {
    const out: Record<string, unknown> = {}
    await mount('quoteTemplates')
    await click(btn('הצעת מחיר חדשה'))
    out.newSheet = dialogs()
    await click(btn('שמור תבנית'))
    out.nameRequired = dialogs()
    await type(document.querySelector('[role="dialog"] input:not([type="number"])'), 'חבילת לוגו')
    await click(btn('שמור תבנית'))
    out.lineRequired = norm(document.querySelector('[role="dialog"] [role="alert"]')?.outerHTML ?? '')
    await type(document.querySelectorAll('[role="dialog"] input')[3], 'עיצוב לוגו')
    for (const reason of ['name_taken', 'forbidden', 'validity_invalid', 'weird_reason']) {
      set({ results: { saveQuoteTemplateAction: { ok: false, reason } } })
      await click(btn('שמור תבנית'))
      await flush()
      out[`refused:${reason}`] = norm(document.querySelector('[role="dialog"] [role="alert"]')?.outerHTML ?? '')
    }
    await click(btn('הוספת שורה'))
    await click(document.querySelector('[role="dialog"] button[aria-label="מחק שורה 1"]'))
    out.linesEdited = dialogs()
    set({ results: {} })
    await click(document.querySelector('[role="dialog"] button[title], [role="dialog"] button.absolute'))
    await click(screen.getAllByText('עריכה')[0].closest('button'))
    out.editSheet = dialogs()
    await click(btn('שמור שינויים'))
    await flush()
    await click(btn('לארכיון'))
    out.archiveConfirm = dialogs()
    await click(btn('העבר לארכיון'))
    await flush()
    set({ results: { setQuoteTemplateStateAction: { ok: false, reason: 'not_found' } } })
    await click(btn('החזרה לשימוש'))
    await flush()
    set({ results: {} })
    await click(btn('החזרה לשימוש'))
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('expired: the sheet keeps the template readable, saving is locked', async () => {
    set({ hasAccess: false })
    await mount('quoteTemplates', EXPIRED)
    await click(screen.getAllByText('עריכה')[0].closest('button'))
    expect(dialogs()).toMatchSnapshot()
  })
})

describe('Hebrew baseline — auto-response', () => {
  test('dirty / saved / every save refusal / unsupported requests / advanced / fixed mode / master off', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount('autoResponse')
    const description = container.querySelectorAll('textarea')[0]
    await type(description, 'מוסך בחולון, גם תיקוני פחחות')
    out.dirty = norm(container.innerHTML)
    for (const reason of ['fixed_body_required', 'business_name_required', 'profile_derivation_failed', 'forbidden']) {
      set({ results: { updateAutoResponseSettings: { ok: false, reason } } })
      await click(btn('שמור שינויים'))
      await flush()
      out[`refused:${reason}`] = norm(container.querySelector('[role="alert"]')?.outerHTML ?? '')
    }
    set({ results: { updateAutoResponseSettings: { ok: true, unsupportedRequests: ['לקבוע תור ביומן', 'לגבות תשלום'] } } })
    await click(btn('שמור שינויים'))
    await flush()
    out.savedUnsupported = norm(container.innerHTML)
    await click(btn('הגדרות מתקדמות'))
    out.advanced = norm(container.innerHTML)
    await click(container.querySelectorAll('input[name="replyMode"]')[1])
    set({ results: { updateAutoResponseSettings: { ok: false, reason: 'fixed_body_required' } } })
    await click(btn('שמור שינויים'))
    await flush()
    out.fixedRequired = norm(container.innerHTML)
    await click(btn('ביטול'))
    await click(container.querySelector('[aria-label="מענה אוטומטי בוואטסאפ"]'))
    out.masterOff = norm(container.innerHTML)
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('the agent test chat: open beside the form, reply, silent turn, refusal, failure, no description', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount('autoResponse')
    // The side panel is open from the start (the narrow-screen launcher opens the same chat in a dialog).
    out.open = norm(container.innerHTML)
    const input = container.querySelector('aside input[aria-label="הודעה כלקוח"]')
    const send = async (text: string) => {
      await type(input, text)
      await click(btn('שליחה'))
      await flush()
    }
    await send('יש לכם תור מחר?')
    set({ results: { previewAgentTurn: { ok: true, reply: '', usedDraft: false, trace: { simulated: null } } } })
    await send('תודה')
    for (const reason of ['no_description', 'ai_unavailable', 'budget_exhausted', 'other']) {
      set({ results: { previewAgentTurn: { ok: false, reason } } })
      await send('עוד שאלה')
      out[`refused:${reason}`] = norm(container.querySelector('[role="alert"]')?.outerHTML ?? '')
    }
    set({ results: { previewAgentTurn: 'throw' } })
    await send('ועוד')
    out.thrown = norm(container.querySelector('[role="alert"]')?.outerHTML ?? '')
    out.chat = norm(container.innerHTML)
    await click(btn('שיחה חדשה'))
    await type(container.querySelectorAll('textarea')[0], '')
    out.noDescription = norm(container.innerHTML)
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — label producers', () => {
  test('quote copy, roles, task template / invitation status words', async () => {
    const copy = await import('@/components/quotes/templateCopy')
    const { MapRoles, rolesOpt } = await import('@/types/roles')
    const reasons = ['forbidden', 'not_found', 'name_taken', 'invalid_input', 'name_required', 'name_too_long', 'title_too_long', 'validity_invalid', 'items_required', 'too_many_items', 'item_title_required', 'item_title_too_long', 'item_quantity_invalid', 'item_price_invalid', 'item_discount_invalid', 'unknown']
    const ago = [null, 'x', NOW, NOW - 30_000, NOW - 5 * 60_000, NOW - 3 * 3_600_000, NOW - 30 * 3_600_000, NOW - 5 * 86_400_000]
    expect({
      errors: Object.fromEntries(reasons.map((r) => [r, copy.quoteTemplateErrorMessage(r)])),
      states: copy.TEMPLATE_STATE_LABEL,
      updated: ago.map((v) => copy.updatedLabel(typeof v === 'number' ? new Date(v).toISOString() : v, NOW)),
      validity: [1, 2, 14, 90].map(copy.validityLabel),
      MapRoles,
      rolesOpt,
      documents: QUOTE_DOCUMENTS[1].items.length,
      channel: CHANNEL.replyMode,
    }).toMatchSnapshot()
  })
})
