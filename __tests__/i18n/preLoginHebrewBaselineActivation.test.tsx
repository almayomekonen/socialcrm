// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SIGNED_IN, preLoginEnv, resetPreLoginEnv } from './preLoginEnv'
import { resolveAsync } from './dashboardHarness'

/**
 * HEBREW BASELINE, part 3 (i18n Phase F4): the REAL `/activate` page (desktop
 * activation on every state of the machine, the "workspace ready" screen, the
 * phone handoff, the redirects), the CTA's busy label, the completed screen's
 * copied state, the phone copy action's three states, and the REAL
 * `/oauth/consent` page (MCP off, signed out, expired / used request, every
 * ineligible reason, the consent card with / without a business name) with the
 * decision form's pending lines; plus a JSON snapshot of the copy producers
 * (`copyFor` for every status, `MOBILE_HANDOFF_COPY`, `SCOPE_LABELS_HE`).
 * Recorded BEFORE Phase F4; no i18n provider, no locale cookie.
 */

vi.mock('next/navigation', async () => (await import('./preLoginMocks')).navigationModule())
vi.mock('next/headers', async () => (await import('./preLoginMocks')).headersModule())
vi.mock('next/server', () => ({ connection: async () => {} }))
vi.mock('@/db/auth', async () => (await import('./preLoginMocks')).authDbModule())
vi.mock('@/config/db', async () => (await import('./preLoginMocks')).configDbModule())
vi.mock('@/lib/device', async () => (await import('./preLoginMocks')).deviceModule())
vi.mock('@/lib/activation/onboarding', async () => (await import('./preLoginMocks')).onboardingModule())
vi.mock('@/lib/activation/useActivationController', async () => (await import('./preLoginMocks')).activationControllerModule())
vi.mock('@/lib/flags/mobileFlags', async () => (await import('./preLoginMocks')).mobileFlagsModule())
vi.mock('@/lib/flags/mcpFlags', async () => (await import('./preLoginMocks')).mcpFlagsModule())
vi.mock('@/lib/clipboard', async () => (await import('./preLoginMocks')).clipboardModule())
vi.mock('@/actions/activation', async () => (await import('./preLoginMocks')).activationActionsModule())
vi.mock('@/lib/facebook/pixelEvents', () => ({ trackCompleteRegistration: () => {} }))
vi.mock('@/lib/oauth/server/pendingRequest', async () => (await import('./preLoginMocks')).oauthPendingModule())
vi.mock('@/lib/oauth/server/consentEligibility', async () => (await import('./preLoginMocks')).consentEligibilityModule())
vi.mock('@/lib/oauth/server/consentDecision', async (orig) => ({
  ...(await orig<object>()),
  isPendingRequestUsed: async () => (await import('./preLoginEnv')).preLoginEnv.pendingUsed,
}))

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')

// jsdom has no media playback; the panel's autoplay attempt resolves.
HTMLMediaElement.prototype.play = () => Promise.resolve()
// The "done" redirect only runs on a desktop viewport; the copy states are what is recorded here.
window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as never

afterEach(() => {
  cleanup()
  resetPreLoginEnv()
})

const PAGES = [
  { id: 'p1', name: 'סלון דנה' },
  { id: 'p2', name: 'סטודיו נועה' },
]
const STATUSES = [
  'waitingForActivation',
  'oauthPending',
  'selectingPage',
  'subscribingPage',
  'activationCompleted',
  'failed',
] as const

async function activatePage(env: Partial<typeof preLoginEnv> = {}) {
  Object.assign(preLoginEnv, { user: SIGNED_IN }, env)
  const { default: Page } = await import('@/app/(he)/activate/page')
  try {
    return renderToString(await resolveAsync(await Page()))
  } catch (e) {
    return (e as Error).message
  }
}

async function consentPage(env: Partial<typeof preLoginEnv> = {}) {
  Object.assign(preLoginEnv, { user: SIGNED_IN }, env)
  const { default: Page } = await import('@/app/(he)/oauth/consent/page')
  try {
    return renderToString(await resolveAsync(await Page()))
  } catch (e) {
    return (e as Error).message
  }
}

describe('Hebrew baseline — /activate', () => {
  test('desktop on every machine state, workspace ready, phone handoff, redirects', async () => {
    const out: Record<string, string> = {}
    for (const status of STATUSES) {
      resetPreLoginEnv()
      out[status] = await activatePage({
        machine: {
          status,
          context: { pages: PAGES, selectedPageId: null, connectedPageName: 'סלון דנה', errorReason: 'denied' },
        },
      })
    }
    resetPreLoginEnv()
    out.alreadyConnected = await activatePage({ alreadyConnected: true })
    out.phone = await activatePage({ mobile: true })
    out.phoneOnboardedClosed = await activatePage({ mobile: true, onboarded: true })
    out.phoneOnboardedAllowed = await activatePage({ mobile: true, onboarded: true, canEnterMobile: true })
    out.desktopOnboarded = await activatePage({ onboarded: true })
    out.signedOut = await activatePage({ user: null })
    expect(out.waitingForActivation).toContain('התחל לקבל לידים')
    expect(out.phone).toContain('SocialCRM עובד במיטבו במחשב.')
    expect(out).toMatchSnapshot()
  })

  test('the CTA busy label, the completed screen copied state, the phone copy states', async () => {
    const out: Record<string, string> = {}
    const { default: ActivationExperience } = await import('@/components/activation/ActivationExperience')
    preLoginEnv.machine = {
      status: 'waitingForActivation',
      context: { pages: [], selectedPageId: null, connectedPageName: null, errorReason: null },
    }
    const waiting = render(<ActivationExperience />)
    fireEvent.click(waiting.container.querySelector('button')!)
    await act(async () => {})
    out.busy = waiting.container.querySelector('button')!.outerHTML
    cleanup()
    // The desktop page shows the "workspace ready" screen for this state; the
    // completed screen itself (its copy-link button) is rendered directly.
    const { default: ActivationScreen } = await import('@/components/activation/ActivationScreen')
    const machine = {
      status: 'activationCompleted',
      context: { pages: [], selectedPageId: null, connectedPageName: 'סלון דנה', errorReason: null },
    } as const
    const completed = render(
      <ActivationScreen
        machine={machine as never}
        onCta={() => {}}
        onSelect={() => {}}
        onRetry={() => {}}
        onContinue={async () => (preLoginEnv.calls.push(['continueDesktop']), true)}
      />,
    )
    fireEvent.click(completed.container.querySelector('button')!)
    for (let i = 0; i < 3; i++) await act(async () => {})
    out.copied = completed.container.innerHTML
    cleanup()
    const { default: MobileHandoff } = await import('@/components/activation/mobile/MobileHandoff')
    for (const ok of [true, false]) {
      preLoginEnv.copyOk = ok
      const view = render(<MobileHandoff />)
      fireEvent.click(view.container.querySelector('button')!)
      for (let i = 0; i < 3; i++) await act(async () => {})
      out[ok ? 'phoneCopied' : 'phoneFailed'] = view.container.innerHTML
      cleanup()
    }
    out.calls = JSON.stringify(preLoginEnv.calls)
    expect(out.copied).toContain('הקישור הועתק')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /oauth/consent', () => {
  test('MCP off, signed out, expired / used request, every ineligible reason, the card', async () => {
    const reasons = [
      'no_user',
      'no_agency',
      'suspended',
      'not_allowlisted',
      'trial_not_started',
      'subscription_required',
    ] as const
    const out: Record<string, string> = {
      mcpOff: await consentPage({ mcp: false }),
      signedOut: (resetPreLoginEnv(), await consentPage({ user: null })),
      expired: (resetPreLoginEnv(), await consentPage({ pending: null })),
      used: (resetPreLoginEnv(), await consentPage({ pendingUsed: true })),
      card: (resetPreLoginEnv(), await consentPage()),
      cardChatGpt:
        (resetPreLoginEnv(),
        await consentPage({
          pending: { ...preLoginEnv.pending!, clientName: 'ChatGPT', redirectUri: 'https://chatgpt.com/cb' },
        })),
      cardNoAgency: (resetPreLoginEnv(), await consentPage({ agencyName: null })),
    }
    for (const reason of reasons) {
      resetPreLoginEnv()
      out[reason] = await consentPage({ eligibility: { reason } })
    }
    expect(out.card).toContain('אשר חיבור ל-Claude')
    expect(out).toMatchSnapshot()
  })

  test('the decision form while approving / cancelling', async () => {
    const { default: ConsentCard } = await import('@/components/oauth/ConsentCard')
    const out: Record<string, string> = {}
    for (const decision of ['approve', 'deny'] as const) {
      const view = render(
        <ConsentCard
          clientName='Claude'
          redirectHost='claude.ai'
          userName='דנה'
          agencyName='סלון דנה'
          scopes={['crm.leads.read', 'crm.conversations.read']}
          csrf={'c'.repeat(32)}
        />,
      )
      const form = view.container.querySelector('form')!
      const ev = new Event('submit', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'submitter', { value: view.container.querySelector(`[data-decision="${decision}"]`) })
      document.addEventListener('submit', (e) => e.preventDefault(), { once: true })
      act(() => void form.dispatchEvent(ev))
      out[decision] = view.container.innerHTML
      cleanup()
    }
    expect(out.approve).toContain('מחבר את Claude…')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — copy producers', () => {
  test('copyFor (every status), the phone handoff copy, the consent scope lines', async () => {
    const { copyFor } = await import('@/lib/activation/activationCopy')
    const { MOBILE_HANDOFF_COPY, DESKTOP_URL, DESKTOP_URL_LABEL } = await import('@/lib/activation/mobileHandoffCopy')
    const { SCOPE_LABELS_HE } = await import('@/lib/oauth/server/config')
    const ctx = { pages: PAGES, selectedPageId: null, connectedPageName: 'סלון דנה', errorReason: null }
    const copy = Object.fromEntries([...STATUSES, 'unknown'].map((s) => [s, copyFor(s as never, ctx)]))
    expect({ copy, MOBILE_HANDOFF_COPY, DESKTOP_URL, DESKTOP_URL_LABEL, SCOPE_LABELS_HE }).toMatchSnapshot()
  })
})
