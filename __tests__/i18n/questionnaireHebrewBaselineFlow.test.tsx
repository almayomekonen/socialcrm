// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { EMPTY_QUESTIONNAIRE, NOW, draftOf, questionnaireEnv, resetQuestionnaireEnv } from './questionnaireEnv'
import { questionnairePage, questionnaireShell } from './questionnaireHarness'

/**
 * HEBREW BASELINE — the questionnaire builder's FLOW view (תרשים) and TEST CHAT
 * (Phase E5c): the map at rest, a box opened (type change, follow-up, answer and
 * "אחר" removal confirmations, deletion), the add-question menu and the "+" on
 * an arrow, the opening and endings boxes, the preview and test drawers, the
 * view switch, the empty map; the test chat (turns, "why", the summary, the
 * teaching offer, every refusal, a failed save). Recorded BEFORE Phase E5c on
 * unmodified product code. React Flow is given sizes the way its own testing
 * guide (and __tests__/a11y/questionnaireFlow.test.tsx) does.
 */

vi.mock('next/navigation', async () => (await import('./questionnaireMocks')).navigationModule())
vi.mock('next/dynamic', async () => (await import('./adminMocks')).nextDynamicModule())
vi.mock('@/lib/toast', async () => (await import('./questionnaireMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./questionnaireMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./questionnaireMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./questionnaireMocks')).deviceModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./questionnaireMocks')).builderFlagsModule())
vi.mock('@/lib/flags/whatsappQuestionnaireFlags', async () => (await import('./questionnaireMocks')).naturalAnswersFlagsModule())
vi.mock('@/lib/inbox/autoresponse/questionnaire/builder/service', async () => (await import('./questionnaireMocks')).serviceModule())
vi.mock('@/actions/questionnaire/builderDraft', async () => (await import('./questionnaireMocks')).draftActionsModule())
vi.mock('@/actions/questionnaire/builderPublish', async () => (await import('./questionnaireMocks')).publishActionsModule())

const norm = (html: string) => html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const set = (overrides: Partial<typeof questionnaireEnv>) => Object.assign(questionnaireEnv, overrides)
const calls = () => JSON.parse(JSON.stringify(questionnaireEnv.calls))
const dialog = () => norm([...document.querySelectorAll('[role="dialog"]')].map((d) => d.outerHTML).join('\n'))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const key = (el: Element | null | undefined, k: string) => act(async () => void fireEvent.keyDown(el!, { key: k }))
const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const labelled = (start: string, root: ParentNode = document) => [...root.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label')!.startsWith(start))
const canvas = () => norm(document.querySelector('.react-flow')!.parentElement!.outerHTML)
const node = (start: string) => labelled(start)!.closest('.react-flow__node') as HTMLElement
const openBox = () => document.querySelector('.react-flow__node.selected') as HTMLElement
const leave = (el: Element) => act(async () => void fireEvent.blur(el, { relatedTarget: document.body }))
const mount = async () => {
  const r = render(await questionnaireShell(null, await questionnairePage()))
  await wait()
  await wait()
  return r
}
const say = async (text: string) => {
  const input = labelled('הודעה כלקוח') ?? document.querySelector('input[placeholder="כתבו כאן כמו לקוח…"]')
  await type(input, text)
  await key(input, 'Enter')
  for (let i = 0; i < 100 && document.querySelector('input[aria-busy="true"]'); i++) await wait(5)
}
const chat = () => norm(document.querySelector('[role="log"]')!.closest('section')!.outerHTML)

beforeAll(async () => {
  class RO {
    constructor(private cb: (entries: Array<{ target: Element }>) => void) {}
    observe(target: Element) {
      this.cb([{ target, contentRect: { width: 1200, height: 800 } } as never])
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as never
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => 300 },
    offsetHeight: { configurable: true, get: () => 200 },
  })
  ;(globalThis as Record<string, unknown>).DOMMatrixReadOnly = class {
    m22 = 1
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (seq = (seq % 997) + 1) / 1000)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  // The Flow view is loaded lazily (next/dynamic): load it before the first render.
  await import('@/components/settings/questionnaire/QuestionnaireBuilder')
  await import('@/components/settings/questionnaire/flow/FlowWorkspace')
  await new Promise((r) => setTimeout(r, 0))
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetQuestionnaireEnv()
})

describe('Hebrew baseline — the Flow view', () => {
  test('the map, an open box, confirmations, menus, opening / endings boxes, drawers, the view switch', async () => {
    const out: Record<string, unknown> = {}
    await mount()
    out.map = canvas()
    await click(labelled('עריכת שאלה 1'))
    out.box = norm(openBox().outerHTML)
    await type(openBox().querySelector('select'), 'free')
    out.typeConfirm = dialog()
    await click(btn('ביטול'))
    await click(labelled('מחיקת התשובה חתונה'))
    out.removeAnswer = dialog()
    await click(btn('ביטול'))
    await click(openBox().querySelector('input[type="checkbox"]'))
    out.otherOff = dialog()
    await click(btn('ביטול'))
    await click(btn('+ שאלת המשך אם בוחרים בזה', openBox()))
    out.followUp = { live: norm(document.querySelector('.sr-only[aria-live]')!.outerHTML), box: norm(openBox().outerHTML) }
    await click(labelled('מחיקת השאלה', openBox()))
    out.deleteConfirm = dialog()
    await click(btn('מחיקת השאלה'))
    await click(btn('הוספת שאלה לפני הסיום'))
    out.menu = norm(document.querySelector('[role="menu"]')!.outerHTML)
    await key(document, 'Escape')
    await click(btn('הוספת שאלה לפני הסיום'))
    await click([...document.querySelectorAll('[role="menuitem"]')][2])
    out.added = { live: norm(document.querySelector('.sr-only[aria-live]')!.outerHTML), box: norm(openBox().outerHTML) }
    await click(labelled('הוספת שאלה אחרי שאלה 1'))
    out.arrowMenu = norm(document.querySelector('[role="menu"]')!.outerHTML)
    await click([...document.querySelectorAll('[role="menuitem"]')][0])
    await click(labelled('עריכת הודעת הפתיחה'))
    await type(document.getElementById('flow-opening'), '')
    await leave(document.getElementById('flow-opening')!)
    out.opening = norm(openBox().outerHTML)
    await click(labelled('עריכת הודעות הסיום'))
    out.endings = norm(openBox().outerHTML)
    await click(btn('איך זה ייראה ללקוח?'))
    out.previewDrawer = norm(document.querySelector('aside')!.outerHTML)
    await key(document.querySelector('aside'), 'Escape')
    await click(btn('בדיקת השאלון'))
    out.testDrawer = norm(document.querySelector('aside')!.outerHTML)
    await click(btn('סגירה וחזרה לתרשים'))
    out.tabs = norm(document.querySelector('[role="tablist"]')!.outerHTML)
    await click(btn('רשימה'))
    out.switched = norm(document.querySelector('[role="tablist"]')!.outerHTML)
    await wait(900)
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('an empty map: the empty state and its menu; the 12-question limit on the map', async () => {
    const out: Record<string, unknown> = {}
    set({ state: { ...questionnaireEnv.state, draft: draftOf(EMPTY_QUESTIONNAIRE) } })
    await mount()
    out.empty = canvas()
    await click(btn('הוספת השאלה הראשונה'))
    out.menu = norm(document.querySelector('[role="menu"]')!.outerHTML)
    await click([...document.querySelectorAll('[role="menuitem"]')][0])
    out.first = canvas()
    for (let i = 0; i < 11; i++) {
      await click(btn('הוספת שאלה לפני הסיום'))
      await click([...document.querySelectorAll('[role="menuitem"]')][2])
    }
    out.full = norm(btn('הוספת שאלה לפני הסיום')!.parentElement!.outerHTML)
    await click(labelled('עריכת שאלה 1'))
    out.fullBox = norm(openBox().outerHTML)
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the test chat', () => {
  test('turns, "why", the summary, teaching, restart', async () => {
    set({ flow: false })
    const out: Record<string, unknown> = {}
    await mount()
    await click(btn('בדיקת השאלון'))
    out.opened = chat()
    await say('היי')
    await say('בננה')
    out.notUnderstood = chat()
    await say('רוצים חינה ממש גדולה')
    out.teach = chat()
    const offer = btn('הוספה לניסוחים של "חינה"')
    if (offer) {
      await click(offer)
      await wait()
      out.taught = chat()
    }
    await click(btn('שיחה חדשה'))
    for (const t of ['היי', 'אנחנו מתחתנים', 'איפור ושיער', '1,2', 'עדיין לא נקבע']) await say(t)
    out.completed = chat()
    await click(btn('חזרה לתצוגה המקדימה'))
    out.calls = calls().filter((c: unknown[]) => c[0] !== 'saveQuestionnaireDraft')
    expect(out).toMatchSnapshot()
  })

  test('every refusal, a thrown error, a failed save', async () => {
    set({ flow: false })
    const out: Record<string, unknown> = {}
    await mount()
    await click(btn('בדיקת השאלון'))
    for (const reason of ['not_ready', 'too_long', 'not_found', 'forbidden', 'bad_input']) {
      questionnaireEnv.results = { simulateQuestionnaireDraft: { ok: false, reason } }
      await say('היי')
      out[reason] = norm(document.querySelector('[role="log"]')!.closest('section')!.querySelector('[role="alert"]')!.outerHTML)
    }
    questionnaireEnv.results = { simulateQuestionnaireDraft: 'throw' }
    await say('היי')
    out.thrown = norm(document.querySelector('section [role="alert"]')!.outerHTML)
    questionnaireEnv.results = { saveQuestionnaireDraft: { ok: false, reason: 'invalid_draft', issues: [] } }
    cleanup()
    await mount()
    await type(document.getElementById('questionnaire-opening'), 'שלום')
    await click(btn('בדיקת השאלון'))
    await say('היי')
    out.saveFailed = chat()
    expect(out).toMatchSnapshot()
  })
})
