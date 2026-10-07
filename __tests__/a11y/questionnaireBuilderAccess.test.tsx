// @vitest-environment jsdom
//
// Questionnaire Builder (PR2): who can reach it, and what everyone else sees.
//
// The rule: an agency outside QUESTIONNAIRE_BUILDER_AGENCY_IDS sees no trace of
// the Builder — no nav item, no "עוד" row, no link in the מענה אוטומטי notice,
// and a 404 on the URL. Inside the rollout, only admins. Phones get the reduced
// status + test view, decided on the server.
//
// No DB: the data layer is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const H = vi.hoisted(() => ({
  user: { id: 5, role: 'ADMIN', agencyId: 158, name: 'Owner', email: 'o@example.com' } as Record<string, unknown>,
  productAccess: true,
  mobile: false,
  state: null as unknown,
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  usePathname: () => '/settings/questionnaire',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))
vi.mock('@/lib/requireUser', async () => {
  class ProductAccessError extends Error {}
  return {
    ProductAccessError,
    requireAgencyUser: async () => H.user,
    requireProductAccess: async () => {
      if (!H.productAccess) throw new ProductAccessError('subscription-required')
      return H.user
    },
  }
})
vi.mock('@/db/auth', () => ({ getUser: async () => H.user }))
vi.mock('@/lib/device', () => ({
  isMobileRequest: async () => H.mobile,
  isMobileWorkspaceRequest: async () => H.mobile,
}))
vi.mock('@/lib/inbox/autoresponse/questionnaire/builder/service', () => ({ getBuilderState: async () => H.state }))
vi.mock('@/components/entitlement/SubscriptionExpiredState', () => ({
  default: ({ feature }: { feature: string }) => <p>expired: {feature}</p>,
}))
vi.mock('@/actions/questionnaire/builderDraft', () => ({}))
vi.mock('@/actions/questionnaire/builderPublish', () => ({
  simulateQuestionnaireDraft: vi.fn(),
  listQuestionnaireRevisions: vi.fn(),
}))
vi.mock('@/components/settings/questionnaire/QuestionnaireBuilder', () => ({ default: () => <p>desktop editor</p> }))

import QuestionnaireBuilderPage from '@/app/(app)/settings/(admin_settings)/questionnaire/page'
import SettingLayout from '@/app/(app)/settings/layout'
import QuestionnaireMobile from '@/components/settings/questionnaire/QuestionnaireMobile'
import QuestionnaireModeNotice from '@/components/settings/autoResponse/QuestionnaireModeNotice'
import { visibleMoreItems } from '@/components/mobile/moreDestinations'
import { MOBILE_READY_ROUTES } from '@/lib/mobile/desktopOnlyRoutes'
import { canUseQuestionnaireBuilder } from '@/lib/flags/questionnaireBuilderFlags'

const state = {
  published: {
    revision: 4,
    questionnaire: {
      opening: 'x',
      questions: [],
      endings: { standard: 'y', custom: [] },
      handoffMessage: 'h',
      summaryTitle: 't',
      settings: { attemptsBeforePerson: 2, abandonAfterHours: 24 },
    },
  },
  draft: null,
  live: { hasSettings: true, routedToQuestionnaire: true, channelEnabled: true, masterEnabled: true },
  activeSessionsByRevision: [],
}

beforeEach(() => {
  process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = '158'
  H.user = { id: 5, role: 'ADMIN', agencyId: 158, name: 'Owner', email: 'o@example.com' }
  H.productAccess = true
  H.mobile = false
  H.state = state
})
afterEach(() => {
  cleanup()
  delete process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS
})

async function renderPage() {
  render(await QuestionnaireBuilderPage())
}

describe('the rollout flag', () => {
  it('absence blocks; only listed agencies (or "all")', () => {
    delete process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS
    expect(canUseQuestionnaireBuilder(158)).toBe(false)
    process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = '103, 158'
    expect(canUseQuestionnaireBuilder(158)).toBe(true)
    expect(canUseQuestionnaireBuilder(63)).toBe(false)
  })
})

describe('the page', () => {
  it('renders the desktop editor for an admin of a rollout agency', async () => {
    await renderPage()
    expect(screen.getByText('desktop editor')).toBeTruthy()
  })

  it('does not exist outside the rollout, whatever the subscription says', async () => {
    process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = '103'
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    H.productAccess = false
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('does not exist for a נציג', async () => {
    H.user = { ...H.user, role: 'USER' }
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('an expired rollout agency is told why, not crashed', async () => {
    H.productAccess = false
    await renderPage()
    expect(screen.getByText(/expired: חידוש המנוי מחזיר את עריכת השאלון/)).toBeTruthy()
  })

  it('a phone gets status + test, not the editor', async () => {
    H.mobile = true
    await renderPage()
    expect(screen.queryByText('desktop editor')).toBeNull()
    expect(screen.getByText('גרסה 4 עונה לפניות חדשות בוואטסאפ.')).toBeTruthy()
    expect(screen.getByText('עריכת השאלון ופרסום גרסה חדשה זמינים במחשב.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'הודעה כלקוח' })).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(MOBILE_READY_ROUTES['/settings/questionnaire']).toBeTruthy()
  })
})

describe('entry points', () => {
  const navLink = () => screen.queryByRole('link', { name: /שאלון וואטסאפ/ })

  it('the settings nav shows "שאלון וואטסאפ" to rollout admins only', async () => {
    render(await SettingLayout({ children: null }))
    expect(navLink()?.getAttribute('href')).toBe('/settings/questionnaire')
    cleanup()

    process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = '103'
    render(await SettingLayout({ children: null }))
    expect(navLink()).toBeNull()
    expect(screen.getByRole('link', { name: /מענה אוטומטי/ })).toBeTruthy()
    cleanup()

    process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = '158'
    H.user = { ...H.user, role: 'USER' }
    render(await SettingLayout({ children: null }))
    expect(navLink()).toBeNull()
  })

  it('the mobile "עוד" row follows the same rule', () => {
    const has = (o: Parameters<typeof visibleMoreItems>[0]) =>
      visibleMoreItems(o).some((i) => i.href === '/settings/questionnaire')
    expect(has({ role: 'ADMIN', inspectorEnabled: false, questionnaireBuilderEnabled: true })).toBe(true)
    expect(has({ role: 'ADMIN', inspectorEnabled: false, questionnaireBuilderEnabled: false })).toBe(false)
    expect(has({ role: 'ADMIN', inspectorEnabled: false })).toBe(false)
    expect(has({ role: 'USER', inspectorEnabled: false, questionnaireBuilderEnabled: true })).toBe(false)
  })

  it('the מענה אוטומטי notice links to the Builder only when given the link; otherwise it is unchanged', () => {
    render(<QuestionnaireModeNotice active />)
    expect(screen.getByText(/לשינוי השאלון, פנו אלינו\./)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    cleanup()
    render(<QuestionnaireModeNotice active builderHref='/settings/questionnaire' />)
    expect(screen.getByRole('link', { name: 'שאלון וואטסאפ' }).getAttribute('href')).toBe('/settings/questionnaire')
  })
})

describe('the phone view', () => {
  it('is honest about a published but not-yet-active questionnaire, and says a draft is waiting', () => {
    render(
      <QuestionnaireMobile
        liveRevision={2}
        published={state.published.questionnaire as never}
        hasDraft
        routing={{ routedToQuestionnaire: false, channelEnabled: true, masterEnabled: true }}
      />,
    )
    expect(screen.getByText(/גרסה 2 פורסמה, אבל השאלון עוד לא מופעל בוואטסאפ/)).toBeTruthy()
    expect(screen.getByText('יש טיוטה פתוחה שעוד לא פורסמה.')).toBeTruthy()
    // The test box is not focused on load: no keyboard popping up on a phone.
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'הודעה כלקוח' }))
  })

  it('with nothing published there is nothing to test, and it says so', () => {
    render(
      <QuestionnaireMobile
        liveRevision={null}
        published={null}
        hasDraft={false}
        routing={{ routedToQuestionnaire: false, channelEnabled: false, masterEnabled: false }}
      />,
    )
    expect(screen.getByText('השאלון עוד לא פורסם. הלקוחות לא מקבלים אותו.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
