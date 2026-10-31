import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'
import type { Surface } from './surfaces'
import { resolveAsync } from './dashboardHarness'

/**
 * Leak-gate registrations for the pre-login screens (i18n Phase F4). Spread
 * into SURFACES (surfaces.tsx). The sign-in and registration PAGES run for real
 * (the gate mocks `getPreLoginLocale` to the scanned locale); the activation
 * screens and the consent screen are rendered as components with fixture
 * props, because their pages read the onboarding flag, the OAuth pending
 * cookie and the activation actions (their pages are scanned in
 * preLoginLocales.test.tsx with the full mocks).
 */

async function provider(locale: UiLocale, node: ReactNode) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  return <I18nProvider locale={locale}>{node}</I18nProvider>
}

const NAME: Allowance = { text: 'דנה כהן', reason: 'customer-data' }
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

export const PRE_LOGIN_SURFACES: Surface[] = [
  {
    name: 'sign-in page — magic link, social buttons, signed-in line',
    route: '/auth',
    render: async () => {
      const { default: Page } = await import('@/app/(auth)/auth/page')
      return (await resolveAsync(await Page({ searchParams: Promise.resolve({ error: '1' }) }))) as never
    },
    // The gate's session user (`דנה כהן`) is shown in "Signing in as …".
    allowed: [NAME],
  },
  {
    name: 'registration page — form, terms row, social buttons',
    route: '/auth/register',
    render: async () => {
      const { default: Page } = await import('@/app/(auth)/auth/register/page')
      return (await resolveAsync(
        await Page({ searchParams: Promise.resolve({ email: 'noa@example.com', name: 'Noa' }) }),
      )) as never
    },
    allowed: [],
  },
  ...STATUSES.map(
    (status): Surface => ({
      name: `activation screen — ${status}`,
      route: '/activate (desktop)',
      render: async (locale) => {
        const { default: ActivationScreen } = await import('@/components/activation/ActivationScreen')
        const machine = {
          status,
          context: { pages: PAGES, selectedPageId: null, connectedPageName: 'סלון דנה', errorReason: 'denied' },
        }
        return provider(
          locale,
          <ActivationScreen
            machine={machine as never}
            onCta={() => {}}
            onSelect={() => {}}
            onRetry={() => {}}
            onContinue={async () => true}
            locale={locale}
          />,
        )
      },
      // The Facebook Page names in the picker are the business's own data.
      allowed: status === 'selectingPage' ? PAGES.map((p) => ({ text: p.name, reason: 'external' as const })) : [],
    }),
  ),
  {
    name: 'phone handoff — heading, copy action, share, support',
    route: '/activate (phone)',
    render: async (locale) => {
      const { default: MobileHandoff } = await import('@/components/activation/mobile/MobileHandoff')
      return provider(locale, <MobileHandoff locale={locale} />)
    },
    allowed: [],
  },
  {
    name: 'OAuth consent card — client, account, scopes, decision buttons',
    route: '/oauth/consent',
    render: async (locale) => {
      const { default: ConsentCard } = await import('@/components/oauth/ConsentCard')
      return provider(
        locale,
        <ConsentCard
          clientName='Claude'
          redirectHost='claude.ai'
          userName='דנה'
          agencyName='סלון דנה'
          scopes={['crm.leads.read', 'crm.conversations.read']}
          csrf={'c'.repeat(32)}
          locale={locale}
        />,
      )
    },
    allowed: [
      { text: 'סלון דנה', reason: 'customer-data' },
      { text: 'דנה', reason: 'customer-data' },
    ],
  },
  {
    name: 'OAuth consent message — named client, billing link',
    route: '/oauth/consent',
    render: async (locale) => {
      const { default: ConsentMessage } = await import('@/components/oauth/ConsentMessage')
      const { translatorFor } = await import('@/lib/i18n/translators')
      const message = translatorFor(locale)('auth.oauth.message.needsAccess', { client: 'Claude' })
      return provider(locale, <ConsentMessage message={message} showBilling clientName='Claude' locale={locale} />)
    },
    allowed: [],
  },
]
