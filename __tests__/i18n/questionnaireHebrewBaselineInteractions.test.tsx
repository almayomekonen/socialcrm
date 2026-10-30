// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NOW, QUESTIONNAIRE, questionnaireEnv, resetQuestionnaireEnv } from './questionnaireEnv'
import { questionnairePage, questionnaireShell } from './questionnaireHarness'

/**
 * HEBREW BASELINE — the questionnaire builder's LIST view (Phase E5c): card
 * validation, ordering, answer-type change and removal confirmations, adding a
 * question (and the 12-question limit), options (add / remove / "אחר" / icon
 * chooser / phrasings / the length refusal), "מתי השאלה תופיע", the free-text
 * check, endings, extra messages, the preview following the card; then
 * publishing (every check / publish refusal, the confirmation, the toast), the
 * version history (rows, restore, refusal, error, empty), autosave conflicts and
 * a draft that cannot be opened. Recorded BEFORE Phase E5c on unmodified
 * product code, with each action's arguments.
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
const alerts = () => norm([...document.querySelectorAll('[role="alert"]')].map((d) => d.outerHTML).join('\n'))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const named = (label: string, root: ParentNode = document) => [...root.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === label)
const iconBtn = (root: Element, start: string, end = '') =>
  [...root.querySelectorAll('button[aria-label]')].find((e) => e.getAttribute('aria-label')!.startsWith(start) && e.getAttribute('aria-label')!.endsWith(end))
const card = (n: number) => document.querySelectorAll('article')[n] as HTMLElement
const leave = (el: Element) => act(async () => void fireEvent.blur(el, { relatedTarget: document.body }))
const header = () => norm(document.querySelector('header')!.outerHTML)
const mount = async () => {
  const r = render(await questionnaireShell(null, await questionnairePage()))
  await wait()
  return r
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (seq = (seq % 997) + 1) / 1000)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetQuestionnaireEnv()
})

describe('Hebrew baseline — questionnaire list view', () => {
  test('cards: validation, order, type change, removal, add, the limit', async () => {
    set({ flow: false })
    const out: Record<string, unknown> = {}
    await mount()
    const prompt = card(0).querySelector('textarea')!
    await type(prompt, '')
    await type(card(0).querySelector('input')!, '')
    await leave(prompt)
    out.invalidCard = norm(card(0).outerHTML)
    await type(card(0).querySelectorAll('input')[1], '')
    await leave(card(0).querySelectorAll('input')[1])
    out.invalidOption = norm(card(0).querySelector('ol')!.outerHTML)
    await type(prompt, 'איזה אירוע אתם מתכננים?')
    await click(iconBtn(card(0), 'העברת השאלה', 'למטה'))
    out.moved = norm(document.querySelector('.sr-only[aria-live]')!.outerHTML)
    await click(iconBtn(card(1), 'העברת השאלה', 'למעלה'))
    await type(card(0).querySelector('select')!, 'free')
    out.typeConfirm = dialog()
    await click(btn('ביטול'))
    await click(named('מחיקת השאלה "שירותים"'))
    out.removeConfirm = dialog()
    await click(btn('מחיקת השאלה'))
    out.removed = norm(document.querySelector('.sr-only[aria-live]')!.outerHTML)
    await click(iconBtn(card(0), 'מחיקת השאלה'))
    out.removeWithDeps = dialog()
    await click(btn('ביטול'))
    await click(btn('הוספת שאלה'))
    out.added = norm(card(3).outerHTML)
    for (let i = 0; i < 8; i++) await click(btn('הוספת שאלה'))
    await click(btn('הוספת שאלה'))
    out.full = norm(btn('הוספת שאלה')!.parentElement!.outerHTML)
    out.otherFull = norm(card(0).querySelector('label.cursor-pointer')!.parentElement!.outerHTML)
    expect(out).toMatchSnapshot()
  })

  test('options, "אחר", icons, phrasings, the length refusal, "מתי", text checks, endings, extra messages, the preview', async () => {
    set({ flow: false })
    const out: Record<string, unknown> = {}
    await mount()
    await click(btn('הוספת אפשרות', card(0)))
    out.optionAdded = norm(card(0).querySelector('ol')!.outerHTML)
    await click(named('מחיקת האפשרות אפשרות 3'))
    await click(named('מחיקת האפשרות חתונה'))
    out.removeOptionConfirm = dialog()
    await click(btn('ביטול'))
    await click(card(0).querySelector('input[type="checkbox"]'))
    out.otherOffConfirm = dialog()
    await click(btn('ביטול'))
    out.otherLine = norm(card(0).querySelector('p.rounded-md.bg-gray-50')!.outerHTML)
    await click(named('הוספת אייקון לתשובה חינה'))
    out.palette = norm(document.querySelector('[role="dialog"][aria-label^="אייקון"]')!.outerHTML)
    await click(named('בחירת האייקון 🎉'))
    await click(named('אייקון לתשובה חינה: 🎉. שינוי'))
    await act(async () => void fireEvent.keyDown(document.querySelector('[role="dialog"][aria-label^="אייקון"]')!, { key: 'Escape' }))
    const newPhrase = card(0).querySelector('input[placeholder="למשל: אנחנו מתחתנים"]')!
    await type(newPhrase, 'חתונה שלנו')
    await click(btn('הוספת ניסוח', card(0)))
    out.phrasings = norm(card(0).querySelector('details')!.outerHTML)
    await click(named('הסרת הניסוח חתונה שלנו'))
    await type(card(0).querySelectorAll('input')[1], 'א'.repeat(41))
    out.refused = norm(card(0).querySelector('ol li')!.outerHTML)
    await click(btn('להציג רק לפי תשובה קודמת', card(2)))
    out.whenEditor = norm(card(2).outerHTML)
    await click(card(2).querySelectorAll('input[type="checkbox"]')[1])
    await click(btn('סיום', card(2)))
    out.whenSentence = norm(card(2).querySelector('p')!.outerHTML)
    await type(card(3).querySelectorAll('select')[1], 'location')
    await click([...card(3).querySelectorAll('button[aria-expanded]')].pop())
    out.textCheck = norm(card(3).outerHTML)
    const endings = document.getElementById('questionnaire-endings')!
    await click(btn('הוספת סיום שונה לפי תשובה', endings))
    await leave(endings.querySelector('textarea')!)
    out.endings = norm(endings.outerHTML)
    await click(named('מחיקת סיום שונה 2'))
    out.endingConfirm = dialog()
    await click(btn('מחיקת הסיום'))
    await click(btn('הודעות נוספות'))
    out.extra = norm(document.getElementById('questionnaire-extra')!.outerHTML)
    await act(async () => void fireEvent.focus(card(1).querySelector('textarea')!))
    out.previewFollowing = norm(document.querySelector('aside')!.outerHTML)
    await click(btn('מה הלקוח יקבל? הצגת ההודעות'))
    out.previewToggle = norm(document.querySelector('aside button')!.outerHTML)
    await wait(900)
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — publishing, history, conflicts', () => {
  test('publish: confirm + toast, every check / publish refusal', async () => {
    set({ flow: false })
    const out: Record<string, unknown> = {}
    await mount()
    await click(btn('פרסום'))
    out.confirm = dialog()
    await click(btn('פרסום גרסה 3'))
    out.published = { header: header(), calls: calls() }
    const issues = [
      { code: 'missing_text', severity: 'error', field: 'prompt', questionId: 'event_type' },
      { code: 'condition_needs_answer', severity: 'error', endingIndex: 0 },
      { code: 'no_questions', severity: 'error' },
      { code: 'other_without_follow_up', severity: 'warning', questionId: 'event_type', optionId: 'other' },
    ]
    const refusals: Array<[string, unknown]> = [
      ['checkQuestionnaireDraft', { ok: true, ready: false, issues }],
      ['checkQuestionnaireDraft', { ok: false, reason: 'forbidden' }],
      ['checkQuestionnaireDraft', { ok: false, reason: 'something_else' }],
      ['publishQuestionnaireDraft', { ok: false, reason: 'draft_out_of_date' }],
      ['publishQuestionnaireDraft', { ok: false, reason: 'invalid', issues }],
      ['publishQuestionnaireDraft', { ok: false, reason: 'version_conflict' }],
    ]
    for (const [name, result] of refusals) {
      questionnaireEnv.results = { [name]: result }
      await click(btn('פרסום'))
      if (name === 'publishQuestionnaireDraft') await click(btn('פרסום גרסה 3'))
      out[`${name}:${(result as { reason?: string }).reason ?? 'not_ready'}`] = alerts()
      await click(btn('הבנתי'))
    }
    expect(out).toMatchSnapshot()
  })

  test('history: rows, restore + toast, refusal, error, empty', async () => {
    set({ flow: false })
    const out: Record<string, unknown> = {}
    await mount()
    await click(btn('היסטוריית גרסאות'))
    await wait()
    out.list = dialog()
    await click(btn('יצירת טיוטה מגרסה זו', document.querySelectorAll('[role="dialog"] li')[1]))
    out.restoreConfirm = dialog()
    await click(btn('יצירת טיוטה מגרסה 1'))
    await wait()
    out.restored = calls()
    questionnaireEnv.results = { openQuestionnaireDraft: { ok: false, reason: 'revision_not_found' } }
    await click(btn('היסטוריית גרסאות'))
    await wait()
    await click(btn('יצירת טיוטה מגרסה זו', document.querySelectorAll('[role="dialog"] li')[0]))
    await click(btn('יצירת טיוטה מגרסה 2'))
    await wait()
    out.restoreRefused = alerts()
    cleanup()
    questionnaireEnv.results = { listQuestionnaireRevisions: { ok: false, reason: 'forbidden' } }
    await mount()
    await click(btn('היסטוריית גרסאות'))
    await wait()
    out.error = dialog()
    cleanup()
    questionnaireEnv.results = { listQuestionnaireRevisions: { ok: true, revisions: [] } }
    set({ state: { ...questionnaireEnv.state, live: { ...questionnaireEnv.state.live, masterEnabled: false } } })
    await mount()
    await click(btn('היסטוריית גרסאות'))
    out.loading = dialog()
    await wait()
    out.empty = dialog()
    expect(out).toMatchSnapshot()
  })

  test('autosave: saving / saved / failed, every conflict; a draft that cannot be opened', async () => {
    set({ flow: false })
    const out: Record<string, unknown> = {}
    for (const result of [undefined, { ok: false, reason: 'invalid_draft', issues: [] }, { ok: false, reason: 'version_conflict' }, { ok: false, reason: 'draft_published' }, { ok: false, reason: 'not_found' }]) {
      questionnaireEnv.results = result ? { saveQuestionnaireDraft: result } : {}
      await mount()
      await type(document.getElementById('questionnaire-opening'), QUESTIONNAIRE.opening + '!')
      await wait(900)
      out[(result as { reason?: string })?.reason ?? 'saved'] = { header: header(), alerts: alerts() }
      cleanup()
    }
    for (const reason of ['forbidden', 'history_missing', 'other']) {
      questionnaireEnv.results = { openQuestionnaireDraft: { ok: false, reason } }
      set({ state: { ...questionnaireEnv.state, draft: null } })
      await mount()
      await wait()
      out[`open:${reason}`] = norm(document.querySelector('.grid.gap-6')!.outerHTML)
      cleanup()
    }
    expect(out).toMatchSnapshot()
  })
})
