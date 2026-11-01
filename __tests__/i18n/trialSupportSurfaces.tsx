import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'
import type { Surface } from './surfaces'
import { resolveAsync } from './dashboardHarness'
import { SUPPORT_CUSTOMER_DATA, resetTrialSupportEnv, trialSupportEnv } from './trialSupportEnv'

/**
 * Leak-gate registrations for the trial gate, the card return page and the
 * support centre (i18n Phase F5). Spread into SURFACES (surfaces.tsx). The
 * support PAGES and their layout run for real (the gate's session user, the
 * support reads from trialSupportEnv); the trial screens the (app) layout
 * renders are components with fixture props inside the interface-language
 * provider, as the layout mounts them; the card return page runs for real (its
 * locale from the mocked `getPreLoginLocale`). Scanned in trialLocales.test.tsx
 * instead: the two portalled dialogs (the welcome modal, the activation
 * celebration), the reactivation paywall (its card form keeps the recorded
 * terms in declared Hebrew regions, checked there region by region) and the
 * verifier's later states (they appear after a poll).
 */

async function provider(locale: UiLocale, node: ReactNode) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  return <I18nProvider locale={locale}>{node}</I18nProvider>
}

const data = (...texts: string[]): Allowance[] =>
  texts.map((text) => {
    if (!SUPPORT_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })

async function page(build: () => Promise<unknown>): Promise<never> {
  try {
    return (await resolveAsync((await build()) as ReactNode)) as never
  } finally {
    resetTrialSupportEnv()
  }
}

async function inLayout(child: () => Promise<unknown>) {
  const { default: Layout } = await import('@/app/(he)/(support)/layout')
  return page(async () => Layout({ children: (await resolveAsync((await child()) as ReactNode)) as ReactNode }))
}

export const TRIAL_SUPPORT_SURFACES: Surface[] = [
  {
    name: 'support centre — layout, landing with requests',
    route: '/support',
    render: async () => inLayout(async () => (await import('@/app/(he)/(support)/support/page')).default()),
    allowed: data('דנה כהן', 'הוואטסאפ לא מתחבר', 'איך מייבאים לידים?', 'החיוב לא ברור לי', 'טופס האתר לא שולח'),
  },
  {
    name: 'support centre — my requests (populated)',
    route: '/support/requests',
    render: async () => page(async () => (await import('@/app/(he)/(support)/support/requests/page')).default()),
    allowed: data('הוואטסאפ לא מתחבר', 'איך מייבאים לידים?', 'החיוב לא ברור לי', 'טופס האתר לא שולח'),
  },
  {
    name: 'support centre — my requests (empty)',
    route: '/support/requests',
    render: async () => {
      trialSupportEnv.requests = []
      return page(async () => (await import('@/app/(he)/(support)/support/requests/page')).default())
    },
    allowed: [],
  },
  ...(['problem', 'question'] as const).map(
    (kind): Surface => ({
      name: `support centre — new request (${kind})`,
      route: '/support/new',
      render: async (locale) =>
        provider(locale, await page(async () => (await import('@/app/(he)/(support)/support/new/page')).default({ searchParams: Promise.resolve({ kind }) }))),
      allowed: [],
    }),
  ),
  {
    name: 'support centre — a thread (waiting for you), the reply box',
    route: '/support/requests/[requestId]',
    render: async (locale) => {
      trialSupportEnv.request = { ...trialSupportEnv.request!, status: 'waiting_for_customer' }
      const { default: Page } = await import('@/app/(he)/(support)/support/requests/[requestId]/page')
      return provider(locale, await page(async () => Page({ params: Promise.resolve({ requestId: '41' }) })))
    },
    allowed: data('הוואטסאפ לא מתחבר', 'ניסיתי פעמיים', 'בודקים את זה עכשיו', 'עדיין לא עובד', 'דנה כהן'),
  },
  ...[undefined, 'whatsapp', 'zzzz'].map(
    (q): Surface => ({
      name: `support centre — guides (${q ?? 'categories'})`,
      route: '/support/guides',
      render: async (locale) =>
        provider(locale, await page(async () => (await import('@/app/(he)/(support)/support/guides/page')).default({ searchParams: Promise.resolve(q ? { q } : {}) }))),
      allowed: [],
    }),
  ),
  {
    name: 'support centre — every guide article',
    route: '/support/guides/[slug]',
    render: async () => {
      const { GUIDE_ARTICLES } = await import('@/lib/support/knowledgeBase')
      const { default: Page } = await import('@/app/(he)/(support)/support/guides/[slug]/page')
      const articles = await Promise.all(GUIDE_ARTICLES.map((a) => page(async () => Page({ params: Promise.resolve({ slug: a.slug }) }))))
      return <>{articles.map((a, i) => <div key={i}>{a}</div>)}</>
    },
    allowed: [],
  },
  {
    name: 'trial expired — leads, upgrade, the lead toasts',
    route: '(app) layout, TRIAL_EXPIRED',
    render: async (locale) => {
      const { default: Screen } = await import('@/components/trial/TrialExpiredScreen')
      return provider(locale, <Screen leadCount={3} leadNames={['דנה כהן']} />)
    },
    allowed: data('דנה כהן'),
  },
  {
    name: 'card return — the REAL /billing/success page (verifying)',
    route: '/billing/success',
    render: async () => page(async () => (await import('@/app/(he)/billing/success/page')).default({ searchParams: Promise.resolve({ source: 'card_trial' }) })),
    allowed: [],
  },
]
