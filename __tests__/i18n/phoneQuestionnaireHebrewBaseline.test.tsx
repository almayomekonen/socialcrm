// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NOW, questionnaireEnv, resetQuestionnaireEnv } from './questionnaireEnv'
import { questionnairePage, questionnaireShell } from './questionnaireHarness'

/**
 * HEBREW BASELINE, the phone questionnaire (i18n Phase F2): the REAL
 * `/settings/questionnaire` page inside the REAL (admin_settings) layout with
 * the device gate answering "phone" (`QuestionnaireMobile`): answering with a
 * draft waiting, published but the auto-response off, published but not routed,
 * no draft, never published. The simulator underneath is the desktop's (its
 * own baseline, Phase E5c). Recorded BEFORE Phase F2 with NO i18n provider.
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

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const live = (routedToQuestionnaire: boolean, channelEnabled = true, masterEnabled = true) => ({ hasSettings: true, routedToQuestionnaire, channelEnabled, masterEnabled })
const html = async () => {
  questionnaireEnv.mobile = true
  return renderToString(await questionnaireShell(null, await questionnairePage()))
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetQuestionnaireEnv()
})

describe('Hebrew baseline — the phone questionnaire', () => {
  test('answering + draft; master off; not routed; no draft; never published', async () => {
    const out: Record<string, string> = {}
    out.answeringDraft = await html()
    questionnaireEnv.state = { ...questionnaireEnv.state, live: live(true, true, false) }
    out.masterOff = await html()
    questionnaireEnv.state = { ...questionnaireEnv.state, live: live(false) }
    out.notRouted = await html()
    questionnaireEnv.state = { ...questionnaireEnv.state, live: live(true), draft: null }
    out.noDraft = await html()
    questionnaireEnv.state = { ...questionnaireEnv.state, published: null }
    out.unpublished = await html()
    expect(out.answeringDraft).toContain('שאלון וואטסאפ')
    expect(out).toMatchSnapshot()
  })
})
