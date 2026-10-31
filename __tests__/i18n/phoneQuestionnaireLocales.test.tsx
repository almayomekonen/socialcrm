// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import type { UiLocale } from '@/lib/i18n/config'
import { NOW, QUESTIONNAIRE, QUESTIONNAIRE_CUSTOMER_DATA, questionnaireEnv, resetQuestionnaireEnv } from './questionnaireEnv'
import { questionnairePage, questionnaireShell } from './questionnaireHarness'
import { findHebrewLeaks } from './leakScan'
import { contentOf } from './questionnaireVerbatim'

/**
 * The phone questionnaire (`QuestionnaireMobile`) in English and Arabic (i18n
 * Phase F2): the live line for every routing state, the draft and desktop
 * notes, the simulator in the interface language (the questionnaire's own
 * questions and answers stay as written), region lang/dir, hydration.
 */

vi.mock('next/navigation', async () => (await import('./questionnaireMocks')).navigationModule())
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('@/db/auth', async () => (await import('./questionnaireMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./questionnaireMocks')).requireUserModule())
vi.mock('@/db/uiLocale', async () => {
  const { questionnaireEnv: env } = await import('./questionnaireEnv')
  return { getUiLocalePrefs: async () => ({ userLocale: (env as { userLocale?: string | null }).userLocale ?? null, agencyLocale: null }) }
})
vi.mock('@/lib/device', async () => (await import('./questionnaireMocks')).deviceModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./questionnaireMocks')).builderFlagsModule())
vi.mock('@/lib/flags/whatsappQuestionnaireFlags', async () => (await import('./questionnaireMocks')).naturalAnswersFlagsModule())
vi.mock('@/lib/inbox/autoresponse/questionnaire/builder/service', async () => (await import('./questionnaireMocks')).serviceModule())
vi.mock('@/actions/questionnaire/builderDraft', async () => (await import('./questionnaireMocks')).draftActionsModule())
vi.mock('@/actions/questionnaire/builderPublish', async () => (await import('./questionnaireMocks')).publishActionsModule())


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
  resetQuestionnaireEnv()
})

const live = (routedToQuestionnaire: boolean, channelEnabled = true, masterEnabled = true) => ({ hasSettings: true, routedToQuestionnaire, channelEnabled, masterEnabled })
const tree = async (locale: UiLocale) => {
  Object.assign(questionnaireEnv, { mobile: true, userLocale: locale })
  return questionnaireShell(locale, await questionnairePage())
}
const allowed = [...QUESTIONNAIRE_CUSTOMER_DATA, ...contentOf(QUESTIONNAIRE)].map((text) => ({ text, reason: 'verbatim-content' as const }))

describe('the phone questionnaire', () => {
  test('English and Arabic: every routing state, notes, simulator chrome', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const states = [live(true), live(true, true, false), live(false)]
      for (const state of states) {
        resetQuestionnaireEnv()
        questionnaireEnv.state = { ...questionnaireEnv.state, live: state }
        const { container } = render(await tree(locale))
        const root = container.querySelector(`[lang="${locale}"]`)!
        expect(root.getAttribute('dir')).toBe(locale === 'en' ? 'ltr' : 'rtl')
        expect(findHebrewLeaks(container, allowed)).toEqual([])
        cleanup()
      }
    }
    resetQuestionnaireEnv()
    questionnaireEnv.state = { ...questionnaireEnv.state, published: null, draft: null }
    const { container } = render(await tree('en'))
    expect(container.textContent).toContain('Once a questionnaire is published, you can test it here.')
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`hydration without a mismatch (${locale})`, async () => {
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => {
        if (/hydrat|did not match|server rendered/i.test(String(a[0]))) errors.push(a)
      })
      const t = await tree(locale)
      const host = document.createElement('div')
      host.innerHTML = renderToString(t)
      document.body.appendChild(host)
      await act(async () => {
        hydrateRoot(host, t, { onRecoverableError: (e) => errors.push(e) })
      })
      host.remove()
      spy.mockRestore()
      expect(errors).toEqual([])
    })
  }
})
