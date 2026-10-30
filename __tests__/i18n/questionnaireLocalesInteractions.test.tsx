// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'
import { findHebrewLeaks, type Allowance } from './leakScan'
import { NOW, QUESTIONNAIRE, questionnaireEnv, resetQuestionnaireEnv } from './questionnaireEnv'
import { contentOf } from './questionnaireVerbatim'

/**
 * The questionnaire builder's flows in he / en / ar (Phase E5c): every action
 * submits exactly what Hebrew submits — the autosaved draft and the publish /
 * restore / test payloads byte-identical — and every checkpoint (cards,
 * confirmations, the icon palette, the history, the alerts, the test chat, the
 * Flow map, its menus and drawers) shows no Hebrew outside the questionnaire's
 * own content and the runtime's messages to the customer; toasts are
 * translated.
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'he' as string | null }, seq: 0 }))
vi.mock('next/navigation', async () => (await import('./questionnaireMocks')).navigationModule())
vi.mock('next/dynamic', async () => (await import('./adminMocks')).nextDynamicModule())
vi.mock('@/lib/toast', async () => (await import('./questionnaireMocks')).toastModule())
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('@/db/auth', async () => (await import('./questionnaireMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./questionnaireMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./questionnaireMocks')).deviceModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./questionnaireMocks')).builderFlagsModule())
vi.mock('@/lib/flags/whatsappQuestionnaireFlags', async () => (await import('./questionnaireMocks')).naturalAnswersFlagsModule())
vi.mock('@/lib/inbox/autoresponse/questionnaire/builder/service', async () => (await import('./questionnaireMocks')).serviceModule())
vi.mock('@/actions/questionnaire/builderDraft', async () => (await import('./questionnaireMocks')).draftActionsModule())
vi.mock('@/actions/questionnaire/builderPublish', async () => (await import('./questionnaireMocks')).publishActionsModule())
const { questionnairePage, questionnaireShell } = await import('./questionnaireHarness')
const { simulateConversation } = await import('@/lib/inbox/autoresponse/questionnaire/builder/simulate')
const { previewDefinition } = await import('@/lib/inbox/autoresponse/questionnaire/builder/editorView')
const { NOT_SET_SUMMARY, HUMAN_HINT } = await import('@/lib/inbox/autoresponse/questionnaire/render')

const HEBREW = /[֐-׿]/
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('control not found')
  await act(async () => void fireEvent.click(el))
}
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const key = (el: Element | Document | null | undefined, k: string) => act(async () => void fireEvent.keyDown(el!, { key: k }))
const leave = (el: Element) => act(async () => void fireEvent.blur(el, { relatedTarget: document.body }))
const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const labelled = (start: string, root: ParentNode = document) => [...root.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label')!.startsWith(start))
const card = (n: number) => document.querySelectorAll('article')[n] as HTMLElement
const dlg = () => [...document.querySelectorAll('[role="dialog"][aria-modal]')].pop()!
const confirmBtn = () => [...dlg().querySelectorAll('button:not(.absolute)')].pop()
const cancelBtn = () => [...dlg().querySelectorAll('button:not(.absolute)')].at(-2)
const openBox = () => document.querySelector('.react-flow__node.selected') as HTMLElement
const say = async (text: string) => {
  const input = document.querySelector('section input[type="text"][maxlength="1000"]')
  await type(input, text)
  await key(input, 'Enter')
  for (let i = 0; i < 100 && document.querySelector('input[aria-busy="true"]'); i++) await wait(5)
}

/** The questionnaire, what the owner types as a customer, what the runtime answers (all sent / received as written), and the rep who published. */
const TYPED = ['דנה כהן', 'שלום לכולם', 'היי', 'בננה', 'אנחנו מתחתנים', '1,2', 'עדיין לא נקבע', 'חתונה שלנו']
let allowed: Allowance[] = []
function runtimeOutput(turns: string[][]) {
  const run = simulateConversation(previewDefinition(QUESTIONNAIRE)!, turns)
  return [...run.turns.flatMap((t) => t.replies), run.summary.title, ...run.summary.fields.flatMap((f) => [f.label, f.value])]
}
let scans: string[] = []
const scan = (where: string) => {
  for (const leak of findHebrewLeaks(document.body, allowed)) scans.push(`${where}: ${leak.where} «${leak.text}»`)
}

/**
 * A new question / option's `ref` is the browser's throwaway name for it until
 * the server assigns an id (model.ts: "never stored"), drawn from Math.random:
 * compared by order of appearance, everything else byte for byte.
 */
function byOrder(json: string): string {
  const seen = new Map<string, string>()
  return json.replace(/new_[a-z0-9]{10}/g, (ref) => seen.get(ref) ?? (seen.set(ref, `new_ref${seen.size}`), seen.get(ref)!))
}

type Flow = (t: Translator, scan: (where: string) => void) => Promise<void>
async function across(overrides: Partial<typeof questionnaireEnv>, flow: Flow) {
  const results: Record<string, { actions: unknown[]; toasts: string[]; scans: string[] }> = {}
  for (const locale of ['he', 'en', 'ar'] as UiLocale[]) {
    resetQuestionnaireEnv()
    Object.assign(questionnaireEnv, overrides)
    H.prefs.userLocale = locale
    H.seq = 0
    scans = []
    render((await questionnaireShell(locale, await questionnairePage())) as ReactNode)
    await wait()
    await wait()
    await flow(translatorFor(locale), locale === 'he' ? () => {} : scan)
    await wait(900)
    const calls = JSON.parse(byOrder(JSON.stringify(questionnaireEnv.calls))) as unknown[][]
    results[locale] = {
      actions: calls.filter((c) => c[0] !== 'toast'),
      toasts: calls.filter((c) => c[0] === 'toast').map((c) => JSON.stringify(c.slice(1))),
      scans: [...scans],
    }
    cleanup()
  }
  for (const locale of ['en', 'ar'] as const) {
    expect(results[locale].actions, `${locale} submits what Hebrew submits`).toEqual(results.he.actions)
    expect(results[locale].scans, locale).toEqual([])
    for (const msg of results[locale].toasts) expect(HEBREW.test(msg), `${locale} toast ${msg}`).toBe(false)
    expect(results[locale].toasts.length, `${locale} toasts`).toBe(results.he.toasts.length)
  }
  expect(results.he.actions.length, 'the flow reached its actions').toBeGreaterThan(0)
  return results
}
const reached = (r: Awaited<ReturnType<typeof across>>, ...names: string[]) =>
  expect([...new Set(r.he.actions.map((a) => (a as unknown[])[0]))]).toEqual(expect.arrayContaining(names))

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
  Object.defineProperties(HTMLElement.prototype, { offsetWidth: { configurable: true, get: () => 300 }, offsetHeight: { configurable: true, get: () => 200 } })
  ;(globalThis as Record<string, unknown>).DOMMatrixReadOnly = class {
    m22 = 1
  }
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.spyOn(Math, 'random').mockImplementation(() => (H.seq = (H.seq % 997) + 1) / 1000)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
  await import('@/components/settings/questionnaire/QuestionnaireBuilder')
  await import('@/components/settings/questionnaire/flow/FlowWorkspace')
  await new Promise((r) => setTimeout(r, 0))
  const contentTexts = [...contentOf(QUESTIONNAIRE), ...contentOf({ ...QUESTIONNAIRE, opening: 'שלום לכולם' }), ...TYPED, NOT_SET_SUMMARY, HUMAN_HINT, ...runtimeOutput([['היי'], ['בננה'], ['אנחנו מתחתנים'], ['1,2'], ['עדיין לא נקבע']])]
  allowed = [...new Set(contentTexts)].filter(Boolean).map((text) => ({ text, reason: 'verbatim-content' as const }))
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetQuestionnaireEnv()
})

describe('questionnaire builder interactions in he / en / ar', () => {
  test('list view: validation, order, type change, removals, options, icons, phrasings, "when", text checks, endings, extra messages — the autosaved draft is identical', async () => {
    const r = await across({ flow: false }, async (t, s) => {
      await type(document.getElementById('questionnaire-opening'), 'שלום לכולם')
      const prompt = card(0).querySelector('textarea')!
      await type(prompt, '')
      await leave(prompt)
      s('a card with problems')
      await type(prompt, QUESTIONNAIRE.questions[0].prompt)
      await click(labelled(t('admin.questionnaire.card.moveDown', { name: 'סוג האירוע' })))
      s('moved (announcement)')
      await click(labelled(t('admin.questionnaire.card.moveUp', { name: 'סוג האירוע' })))
      await type(card(0).querySelector('select'), 'free')
      s('type change confirmation')
      await click(cancelBtn())
      await click(labelled(t('admin.questionnaire.card.remove', { name: 'שירותים' })))
      s('removal confirmation')
      await click(confirmBtn())
      await click(btn(t('admin.questionnaire.editor.addQuestion')))
      await click(btn(t('admin.questionnaire.options.add'), card(0)))
      await click(labelled(t('admin.questionnaire.option.remove', { name: 'חתונה' })))
      s('option removal with consequences')
      await click(cancelBtn())
      await click(card(0).querySelector('input[type="checkbox"]'))
      s('"Other" off confirmation')
      await click(cancelBtn())
      await click(labelled(t('admin.questionnaire.icon.add', { name: 'חינה' })))
      s('icon palette')
      await click(labelled(t('admin.questionnaire.icon.pick', { icon: '🎉' })))
      await type(card(0).querySelector('details input'), 'חתונה שלנו')
      await click(btn(t('admin.questionnaire.phrasings.add'), card(0)))
      await type(card(0).querySelectorAll('input')[1], 'א'.repeat(41))
      s('options, phrasings, the length refusal')
      await click(btn(t('admin.questionnaire.when.byAnswer'), card(2)))
      await click(card(2).querySelectorAll('input[type="checkbox"]')[1])
      s('"when" editor')
      await click(btn(t('admin.questionnaire.when.done'), card(2)))
      await type(card(2).querySelectorAll('select')[1], 'location')
      const endings = document.getElementById('questionnaire-endings')!
      await click(btn(t('admin.questionnaire.endings.add'), endings))
      await leave(endings.querySelector('textarea')!)
      s('endings with a new one')
      await click(labelled(t('admin.questionnaire.endings.remove', { number: '2' })))
      await click(confirmBtn())
      await click(btn(t('admin.questionnaire.extra.title')))
      await act(async () => void fireEvent.focus(card(1).querySelector('textarea')!))
      s('extra messages, the preview following a question')
    })
    reached(r, 'saveQuestionnaireDraft')
  })

  test('publishing: confirmation, toast, every refusal; history, restore, refusal; autosave conflict', async () => {
    const issues = [
      { code: 'missing_text', severity: 'error', field: 'prompt', questionId: 'event_type' },
      { code: 'condition_needs_answer', severity: 'error', endingIndex: 0 },
      { code: 'phrasing_is_all', severity: 'error', questionId: 'services' },
    ]
    const r = await across({ flow: false }, async (t, s) => {
      await click(btn(t('admin.questionnaire.header.publish')))
      s('publish confirmation')
      await click(confirmBtn())
      await wait()
      for (const [name, result] of [
        ['checkQuestionnaireDraft', { ok: true, ready: false, issues }],
        ['checkQuestionnaireDraft', { ok: false, reason: 'forbidden' }],
        ['publishQuestionnaireDraft', { ok: false, reason: 'draft_out_of_date' }],
        ['publishQuestionnaireDraft', { ok: false, reason: 'mystery' }],
      ] as const) {
        questionnaireEnv.results = { [name]: result }
        await click(btn(t('admin.questionnaire.header.publish')))
        if (name === 'publishQuestionnaireDraft') await click(confirmBtn())
        s(`refused: ${name}`)
        await click(btn(t('admin.questionnaire.alerts.ok')))
      }
      questionnaireEnv.results = {}
      await click(btn(t('admin.questionnaire.header.history')))
      await wait()
      s('version history')
      await click(btn(t('admin.questionnaire.history.restore'), document.querySelectorAll('[role="dialog"] li')[1]))
      s('restore confirmation')
      await click(confirmBtn())
      await wait()
      questionnaireEnv.results = { saveQuestionnaireDraft: { ok: false, reason: 'version_conflict' } }
      await type(document.getElementById('questionnaire-opening'), 'שלום לכולם')
      await wait(900)
      s('autosave stopped')
    })
    reached(r, 'checkQuestionnaireDraft', 'publishQuestionnaireDraft', 'listQuestionnaireRevisions', 'discardQuestionnaireDraft', 'openQuestionnaireDraft', 'saveQuestionnaireDraft')
    expect(r.en.toasts).toEqual(['["success","Version 3 published"]', '["success","A draft was created from version 1"]'])
  })

  test('the test chat: turns, "why", teaching, the summary, refusals', async () => {
    const r = await across({ flow: false }, async (t, s) => {
      await click(btn(t('admin.questionnaire.header.test')))
      s('empty chat')
      for (const text of ['היי', 'בננה']) await say(text)
      s('not understood, the teaching fallback')
      for (const text of ['אנחנו מתחתנים', '1,2', 'עדיין לא נקבע']) await say(text)
      s('completed with the summary')
      for (const reason of ['not_ready', 'too_long', 'bad_input']) {
        questionnaireEnv.results = { simulateQuestionnaireDraft: { ok: false, reason } }
        await say('היי')
        s(`refused: ${reason}`)
      }
      await click(btn(t('admin.questionnaire.simulator.back')))
    })
    reached(r, 'simulateQuestionnaireDraft')
  })

  test('the Flow view: the map, an open box, menus, the "+" on an arrow, deletion, opening / endings boxes, drawers, the empty map', async () => {
    const r = await across({}, async (t, s) => {
      s('the map')
      await click(labelled(t('admin.questionnaireFlow.summary.edit', { number: '1' })))
      s('an open box')
      await type(openBox().querySelector('select'), 'free')
      s('type change confirmation')
      await click(cancelBtn())
      await click(btn(t('admin.questionnaireFlow.option.addFollowUp'), openBox()))
      await click(labelled(t('admin.questionnaire.card.remove', { name: '' }).replace(/""$/, ''), openBox()))
      s('deletion confirmation')
      await click(confirmBtn())
      await click(btn(t('admin.questionnaireFlow.addBeforeEnd')))
      s('add-question menu')
      await click(document.querySelectorAll('[role="menuitem"]')[2])
      await click(labelled(t('admin.questionnaireFlow.insert', { where: t('admin.questionnaireFlow.afterQuestion', { number: '1' }) })))
      s('the "+" on an arrow')
      await click(document.querySelectorAll('[role="menuitem"]')[0])
      await click(labelled(t('admin.questionnaireFlow.opening.edit')))
      await type(document.getElementById('flow-opening'), '')
      await leave(document.getElementById('flow-opening')!)
      s('the opening box')
      await click(labelled(t('admin.questionnaireFlow.endings.edit')))
      s('the endings box')
      await click(btn(t('admin.questionnaire.header.preview')))
      s('the preview drawer')
      await key(document.querySelector('aside'), 'Escape')
      await click(btn(t('admin.questionnaire.header.test')))
      s('the test drawer')
    })
    reached(r, 'saveQuestionnaireDraft')
  })
})
