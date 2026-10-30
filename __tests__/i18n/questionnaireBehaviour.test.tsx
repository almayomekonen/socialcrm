// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { translatorFor } from '@/lib/i18n/translators'
import { NOW, questionnaireEnv, resetQuestionnaireEnv } from './questionnaireEnv'

/**
 * Behaviour of the translated questionnaire builder (Phase E5c, en / ar):
 * validation and publish refusals are shown translated (the business's words
 * quoted as written); Escape and focus on the icon palette, the add-question
 * menu, the Flow drawers and the confirmations; icon-only controls named in the
 * interface language; after a deletion on the map the cursor still lands on a
 * surviving box's "Edit"; stored values (answer kinds, checks) are unchanged;
 * the publish / runtime path is untouched.
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'en' as string | null } }))
vi.mock('next/navigation', async () => (await import('./questionnaireMocks')).navigationModule())
vi.mock('next/dynamic', async () => (await import('./adminMocks')).nextDynamicModule())
vi.mock('@/lib/toast', async () => (await import('./questionnaireMocks')).toastModule())
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

const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('control not found')
  await act(async () => void fireEvent.click(el))
}
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const frames = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const key = (el: Element | Document | null | undefined, k: string) => act(async () => void fireEvent.keyDown(el!, { key: k }))
const leave = (el: Element) => act(async () => void fireEvent.blur(el, { relatedTarget: document.body }))
const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const labelled = (label: string, root: ParentNode = document) => [...root.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === label)
const card = (n: number) => document.querySelectorAll('article')[n] as HTMLElement
const openBox = () => document.querySelector('.react-flow__node.selected') as HTMLElement
const HEBREW = /[֐-׿]/
const mount = async (locale: 'en' | 'ar', overrides: Partial<typeof questionnaireEnv> = {}) => {
  Object.assign(questionnaireEnv, overrides)
  H.prefs.userLocale = locale
  const r = render(await questionnaireShell(locale, await questionnairePage()))
  await wait()
  await wait()
  return r
}

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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
  await import('@/components/settings/questionnaire/QuestionnaireBuilder')
  await import('@/components/settings/questionnaire/flow/FlowWorkspace')
  await new Promise((r) => setTimeout(r, 0))
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetQuestionnaireEnv()
})

describe('validation and refusals are translated', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      const t = translatorFor(locale)
      await mount(locale, { flow: false })
      const prompt = card(0).querySelector('textarea')!
      await type(prompt, '')
      await type(card(0).querySelectorAll('input')[1], '')
      await leave(prompt)
      await leave(card(0).querySelectorAll('input')[1])
      expect(card(0).textContent).toContain(t('admin.questionnaireCopy.cardIssue.prompt'))
      expect(card(0).textContent).toContain(t('admin.questionnaire.option.missing'))
      questionnaireEnv.results = { checkQuestionnaireDraft: { ok: true, ready: false, issues: [{ code: 'too_few_options', severity: 'error', questionId: 'services' }] } }
      await click(btn(t('admin.questionnaire.header.publish')))
      const alert = document.querySelector('[role="alert"]')!
      expect(alert.textContent).toContain(t('admin.questionnaireCopy.publish.notReady'))
      expect(alert.textContent).toContain(t('admin.questionnaireCopy.issue.tooFewOptions', { question: '"אילו שירותים מעניינים אתכם?"' }))
      expect(alert.textContent).toContain(t('admin.questionnaire.alerts.toQuestion'))
    })
  }
})

describe('Escape and focus', () => {
  test('the icon palette closes on Escape and gives the cursor back to its button', async () => {
    const t = translatorFor('en')
    await mount('en', { flow: false })
    const trigger = labelled(t('admin.questionnaire.icon.add', { name: 'חינה' })) as HTMLElement
    await click(trigger)
    const palette = labelled(t('admin.questionnaire.icon.palette', { name: 'חינה' }))!
    expect(palette.getAttribute('role')).toBe('dialog')
    await key(palette, 'Escape')
    expect(labelled(t('admin.questionnaire.icon.palette', { name: 'חינה' }))).toBeUndefined()
    expect(document.activeElement).toBe(trigger)
  })

  test('a confirmation declares the interface language and closes on Escape', async () => {
    const t = translatorFor('ar')
    await mount('ar', { flow: false })
    await click(labelled(t('admin.questionnaire.card.remove', { name: 'שירותים' })))
    const dialog = document.querySelector('[role="dialog"][aria-modal]')!
    expect([dialog.closest('[lang]')?.getAttribute('lang'), dialog.closest('[dir]')?.getAttribute('dir')]).toEqual(['ar', 'rtl'])
    expect(dialog.textContent).toContain(t('admin.questionnaire.card.removeMsg', { name: 'שירותים' }))
    await key(dialog, 'Escape')
    await wait()
    expect(document.querySelector('[role="dialog"][aria-modal]')).toBeNull()
  })

  test('the add-question menu: Escape returns to its button; the preview drawer: Escape closes it and returns to its opener', async () => {
    const t = translatorFor('en')
    await mount('en')
    const add = btn(t('admin.questionnaireFlow.addBeforeEnd'))!
    await click(add)
    expect(document.querySelector('[role="menu"]')!.getAttribute('aria-label')).toBe(t('admin.questionnaireFlow.kinds.title'))
    await key(document, 'Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(add)
    const preview = btn(t('admin.questionnaire.header.preview'))!
    preview.focus()
    await click(preview)
    const drawer = document.querySelector('aside')!
    expect(drawer.getAttribute('aria-label')).toBe(t('admin.questionnaireFlow.drawer.preview'))
    expect(drawer.className).toContain('desktop:right-0')
    await key(drawer, 'Escape')
    await frames()
    expect(document.querySelector('aside')).toBeNull()
    expect(document.activeElement).toBe(preview)
  })

  for (const locale of ['en', 'ar'] as const) {
    test(`after a deletion on the map the cursor lands on a surviving box's "Edit" (${locale})`, async () => {
      const t = translatorFor(locale)
      await mount(locale)
      await click(labelled(t('admin.questionnaireFlow.summary.editWithPrompt', { number: '3', prompt: 'אילו שירותים מעניינים אתכם?' })))
      await click(labelled(t('admin.questionnaire.card.remove', { name: 'שירותים' }), openBox()))
      await click([...document.querySelectorAll('[role="dialog"] button:not(.absolute)')].pop())
      for (let i = 0; i < 10; i++) await frames()
      expect(document.activeElement?.getAttribute('aria-label')).toBe(t('admin.questionnaireFlow.summary.editWithPrompt', { number: '2', prompt: 'בשמחה, ספרו לנו בקצרה במה מדובר.' }))
    })
  }
})

describe('names and stored values', () => {
  test('icon-only controls are named in the interface language (list and map)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      await mount(locale, { flow: false })
      const unnamed = [...document.querySelectorAll('button')].filter((b) => !b.textContent?.trim() || /^[×↑↓+]$/.test(b.textContent.trim()))
      expect(unnamed.length).toBeGreaterThan(5)
      for (const b of unnamed) {
        const name = (b.getAttribute('aria-label') ?? '').replace(/"[^"]*"/g, '').replace(/[֐-׿]+/g, '')
        expect(name.trim().length, b.outerHTML.slice(0, 120)).toBeGreaterThan(0)
        expect(HEBREW.test(name), name).toBe(false)
      }
      cleanup()
      resetQuestionnaireEnv()
      await mount(locale)
      await click(document.querySelector(`button[aria-label^="${translatorFor(locale)('admin.questionnaireFlow.summary.edit', { number: '1' })}"]`))
      for (const b of openBox().querySelectorAll('button')) if (/^[×↑↓]$/.test(b.textContent!.trim())) expect(b.getAttribute('aria-label')).not.toMatch(/^[֐-׿]/)
      cleanup()
    }
  })

  test('the answer-type and check options submit the same values in every language', async () => {
    const values: Record<string, string[]> = {}
    for (const locale of ['en', 'ar'] as const) {
      await mount(locale, { flow: false })
      values[locale] = [...document.querySelectorAll('article select option')].map((o) => (o as HTMLOptionElement).value)
      cleanup()
    }
    expect(values.en).toEqual(values.ar)
    expect(values.en).toEqual(expect.arrayContaining(['single', 'multi', 'free', 'none', 'date', 'meaningful', 'location']))
  })

  test('the questionnaire runtime, publish and sending path is untouched', () => {
    const dir = path.join(process.cwd(), 'lib/inbox/autoresponse/questionnaire')
    const files: string[] = []
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))))
    walk(dir)
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), path.relative(process.cwd(), f)).not.toMatch(/lib\/i18n|useT\(|translatorFor/)
  })
})
