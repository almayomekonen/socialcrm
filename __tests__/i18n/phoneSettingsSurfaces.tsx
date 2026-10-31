import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'
import type { Surface } from './surfaces'
import { resolveAsync } from './dashboardHarness'
import { TEMPLATES } from './settingsEnv'
import { ADMIN_CUSTOMER_DATA, ALL_USERS, CHANNEL, INVITATIONS } from './adminEnv'
import { withAdminEnv } from './adminHarness'

/**
 * Leak-gate registrations for the phone settings screens (i18n Phase F2):
 * the Integrations landing, the ready-messages screen and workspace, the
 * users list, auto-response, the questionnaire status, the login activity
 * list. Rendered as components with fixture props inside the provider (the
 * gate's device mock answers "desktop" for the pages); the portalled sheets are
 * scanned where they are opened (phoneSettingsLocales / phoneAdminLocales).
 */

async function provider(locale: UiLocale, node: ReactNode) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  return (
    <I18nProvider locale={locale}>
      <EntitlementProvider value={{ hasAccess: true, status: 'PAID', expiresAt: null }}>{node}</EntitlementProvider>
    </I18nProvider>
  )
}

const data = (...texts: string[]): Allowance[] => texts.map((text) => ({ text, reason: 'customer-data' as const }))

const LANDING = {
  initialSheet: null,
  whatsapp: { connection: { phoneNumberId: 'ph1' }, pendingPhones: null, appId: '', configId: '', graphVersion: 'v21.0', status: 'operational' as const },
  facebook: { connection: { pageId: 'p1', pageName: 'סטודיו דנה' }, pendingPages: null, health: { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false } as never },
  templates: { enabled: true, connected: true, messagingReady: true, total: 3, approved: 1, pending: 1 },
  calendar: { state: 'connected' as const, email: 'dana@gmail.test', lastError: null },
  websiteVisible: true,
}

export const PHONE_SETTINGS_SURFACES: Surface[] = [
  {
    name: 'phone Integrations landing — everything connected, the website card',
    route: '/settings/integrations (phone)',
    render: async (locale) => {
      const { default: IntegrationsLanding } = await import('@/modules/settings/mobile/IntegrationsLanding')
      return provider(locale, <IntegrationsLanding {...LANDING} />)
    },
    allowed: data('סטודיו דנה'),
  },
  {
    name: 'phone Integrations landing — nothing connected, calendar re-auth, a Facebook error return',
    route: '/settings/integrations?error= (phone)',
    render: async (locale) => {
      const { default: IntegrationsLanding } = await import('@/modules/settings/mobile/IntegrationsLanding')
      return provider(
        locale,
        <IntegrationsLanding
          {...LANDING}
          oauthQuery={{ error: 'no_pages', gdrive_error: 'denied' }}
          whatsapp={{ ...LANDING.whatsapp, connection: null, status: 'disconnected' }}
          facebook={{ connection: null, pendingPages: null, health: null }}
          templates={{ ...LANDING.templates, connected: false }}
          calendar={{ state: 'reauth_required', email: null, lastError: null }}
        />,
      )
    },
    allowed: [],
  },
  {
    name: 'phone ready messages — the list (every status) and the not-connected screen',
    route: '/settings/integrations?section=templates (phone)',
    render: async (locale) => {
      const { default: ReadyMessagesWorkspace } = await import('@/modules/templates/mobile/ReadyMessagesWorkspace')
      const { default: ReadyMessagesScreen } = await import('@/modules/templates/mobile/ReadyMessagesScreen')
      const screen = await resolveAsync(<ReadyMessagesScreen agencyId={103} connected={false} messagingReady={false} locale={locale} />)
      return provider(
        locale,
        <>
          <ReadyMessagesWorkspace initial={structuredClone(TEMPLATES) as never} />
          {screen}
        </>,
      )
    },
    allowed: data(...TEMPLATES.flatMap((t) => [t.displayTitle, t.bodyText])),
  },
  {
    name: 'phone users list — users, invitations, roles, suspended',
    route: '/settings/edit_users (phone)',
    render: async (locale) => {
      const { default: UsersListMobile } = await import('@/components/settings/mobile/UsersListMobile')
      const users = ALL_USERS.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, suspended: u.suspended }))
      const invitations = INVITATIONS.map((i) => ({ id: i.id, name: `${i.firstName} ${i.lastName}`, email: i.email, role: i.role, status: i.status, expiresAt: '27/10/2026' }))
      return provider(locale, <UsersListMobile users={users} invitations={invitations} />)
    },
    allowed: data(...ADMIN_CUSTOMER_DATA.filter((t) => ['דנה כהן', 'משה לוי', 'רונית אברהם'].includes(t)), 'יוסי מזרחי', 'שרה גולן'),
  },
  {
    name: 'phone auto-response — AI with the business description, the questionnaire notice',
    route: '/settings/auto-response (phone)',
    render: async (locale) => {
      const { default: AutoResponseMobile } = await import('@/modules/settings/mobile/AutoResponseMobile')
      const node = await withAdminEnv({ channel: { ...CHANNEL, responder: 'questionnaire' } }, async () =>
        resolveAsync(<AutoResponseMobile agencyId={103} role={'ADMIN' as never} locale={locale} />),
      )
      return provider(locale, node)
    },
    // The Smart Agent's business description and its label are AI configuration (owner order), in a declared Hebrew island.
    allowed: [
      { text: CHANNEL.guidance, reason: 'ai-config' },
      { text: 'על העסק שלכם', reason: 'ai-config' },
    ],
  },
  {
    name: 'phone questionnaire status and the login activity list',
    route: '/settings/questionnaire, /settings/update_security (phone)',
    render: async (locale) => {
      const { default: QuestionnaireMobile } = await import('@/components/settings/questionnaire/QuestionnaireMobile')
      const { default: LoginActivityMobile } = await import('@/components/settings/mobile/LoginActivityMobile')
      const routing = { routedToQuestionnaire: true, channelEnabled: true, masterEnabled: false }
      return provider(
        locale,
        <>
          <QuestionnaireMobile liveRevision={2} published={null} hasDraft routing={routing} locale={locale} />
          <LoginActivityMobile rows={[{ device: 'Chrome · macOS', ip: '10.0.0.1', at: '2026-10-29T08:00:00.000Z' }]} locale={locale} />
        </>,
      )
    },
    // The simulator under a published questionnaire is scanned with its content in phoneQuestionnaireLocales.test.tsx.
    allowed: [],
  },
]
