import type { ReactElement } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'
import { DASHBOARD_CUSTOMER_DATA, STATS, dashboardEnv } from './dashboardFixtures'
import { resolveAsync } from './dashboardHarness'
import { FAILING_INTAKE, LEADS_CUSTOMER_DATA, LEADS_DEFAULTS, leadsEnv } from './leadsEnv'
import { clientsPage, leadsPage, shell } from './leadsHarness'
import { ROWS, makeLead } from './leadsFixtures'
import { LEAD_DETAIL_SURFACES } from './leadDetailSurfaces'
import { LEAD_TABS_SURFACES } from './leadTabsSurfaces'
import { INBOX_SURFACES } from './inboxSurfaces'
import { MESSENGER_COMMENTS_SURFACES } from './messengerCommentsSurfaces'
import { INBOX_MOBILE_SURFACES } from './inboxMobileSurfaces'
import { GLOBAL_TASKS_FILES_SURFACES } from './globalTasksFilesSurfaces'
import { CALENDAR_SURFACES } from './calendarSurfaces'
import { DEALS_SURFACES } from './dealsSurfaces'
import { BILLING_SURFACES } from './billingSurfaces'
import { SETTINGS_SURFACES } from './settingsSurfaces'
import { ADMIN_SURFACES } from './adminSurfaces'

/**
 * COMPLETED screens. A screen is listed here only when every piece of
 * system-generated text in it is translated; from then on leakGate.test.tsx
 * fails if Hebrew reappears in its en/ar render outside `allowed`.
 *
 * Adding a screen (Phase B onwards): render it with realistic fixture data,
 * list only the data values it shows verbatim, and give each a reason.
 * Unused allowances fail the gate, so this list cannot drift into a blanket
 * suppression.
 *
 * Rendering relies on the mocks declared in leakGate.test.tsx (navigation,
 * session, locale read). `locale` is applied both to the client provider and
 * to the mocked stored preference, so server-rendered parts translate too.
 */

export const FIXTURE_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

/** A leads-surface allowance: only a value declared as fixture customer data may be allowed. */
function leadsData(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!LEADS_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

/** Run a page's server reads under `overrides`, then restore the defaults other surfaces expect. */
async function withLeadsEnv<T>(overrides: Partial<typeof LEADS_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(leadsEnv, LEADS_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(leadsEnv, LEADS_DEFAULTS)
  }
}

export type Surface = {
  name: string
  route: string
  render: (locale: UiLocale) => Promise<ReactElement>
  allowed: Allowance[]
}

export const SURFACES: Surface[] = [
  {
    name: 'app shell (topbar + side nav)',
    route: '(all workspace routes)',
    render: async (locale) => {
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { default: Topbar } = await import('@/lib/navs/Topbar')
      const { default: Nav } = await import('@/lib/navs/Nav')
      return (
        <I18nProvider locale={locale}>
          <Topbar user={FIXTURE_USER} trialDaysRemaining={3} />
          <Nav user={FIXTURE_USER} inboxUnread={4} />
        </I18nProvider>
      )
    },
    allowed: [
      { text: 'דנה כהן', reason: 'customer-data' },
      { text: 'ד', reason: 'customer-data' },
    ],
  },
  {
    name: 'settings navigation',
    route: '/settings/*',
    render: async (locale) => {
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { default: SettingLayout } = await import('@/app/(app)/settings/layout')
      return <I18nProvider locale={locale}>{await SettingLayout({ children: null })}</I18nProvider>
    },
    allowed: [],
  },
  {
    name: 'language settings',
    route: '/settings/language',
    render: async (locale) => {
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { default: LanguageSettings } = await import('@/components/settings/language/LanguageSettings')
      return (
        <I18nProvider locale={locale}>
          <LanguageSettings locale={locale} source='user' userLocale={locale} agencyLocale={null} canManageAgency />
        </I18nProvider>
      )
    },
    allowed: [{ text: 'עברית', reason: 'endonym' }],
  },
  // ── Phase C: /leads and /clients list surfaces ──────────────────────────
  {
    name: 'leads list — table, toolbar, status tabs, every banner',
    route: '/leads',
    render: async (locale) => {
      const page = await withLeadsEnv({ meta: { connected: true, needsReconnect: true }, intakeFacts: FAILING_INTAKE }, () =>
        leadsPage({ firstImport: '24', firstLeadId: '5', firstImportSkipped: '3' }),
      )
      return shell(locale, page)
    },
    // The `new` tab: three leads; the saved-list picker shows each list's title.
    allowed: leadsData('דנה כהן', 'יוסי לוי', 'מיכל אברהם', 'לקוחות חמים', 'מהקמפיין'),
  },
  {
    name: 'clients list (closed leads)',
    route: '/clients',
    render: async (locale) => {
      const page = await withLeadsEnv({ rows: ROWS.filter((r) => r.status === 'closed') }, () => clientsPage())
      return shell(locale, page)
    },
    allowed: leadsData('נועה ביטון', 'לקוחות חמים', 'מהקמפיין'),
  },
  {
    name: 'leads first run (desktop, empty workspace)',
    route: '/leads',
    render: async (locale) => {
      return shell(locale, await withLeadsEnv({ hasLeads: false }, () => leadsPage()))
    },
    allowed: [],
  },
  {
    name: 'leads first run (mobile, empty workspace)',
    route: '/leads (phone)',
    render: async (locale) => {
      const { default: LeadsFirstRunMobile } = await import('@/modules/leads/mobile/LeadsFirstRunMobile')
      return shell(locale, <LeadsFirstRunMobile metaConnected={false} whatsappConnected={false} />)
    },
    allowed: [],
  },
  {
    name: 'leads table empty states',
    route: '/leads',
    render: async (locale) => {
      const { default: Empty } = await import('@/components/clients/LeadsTableEmptyState')
      const noop = () => {}
      const base = { filteredCount: 0, activeTab: 'new', setActiveTab: noop, onClearScope: noop, onAddLead: noop, onUploadLeads: noop }
      const rows = [{ status: 'contacted' }, { status: 'lost' }]
      return shell(
        locale,
        <>
          <Empty {...base} leads rows={[]} scoped={false} />
          <Empty {...base} leads={false} rows={[]} scoped={false} />
          <Empty {...base} leads rows={[]} scoped scopeKind='search' />
          <Empty {...base} leads={false} rows={[]} scoped scopeKind='filter' />
          <Empty {...base} leads rows={rows} scoped={false} />
        </>,
      )
    },
    allowed: [],
  },
  {
    name: 'lead forms — add/edit, duplicates, assign, transfer, list, import, paste, sync',
    route: '/leads (dialogs)',
    render: async (locale) => {
      const { default: ClientFormPop } = await import('@/components/clients/ClientFormPop')
      const { default: DuplicateLeadBanner } = await import('@/components/clients/DuplicateLeadBanner')
      const { default: BulkAssignLeadsForm } = await import('@/components/clients/BulkAssignLeadsForm')
      const { default: TransferClientForm } = await import('@/components/clients/TransferClientForm')
      const { default: ListForm } = await import('@/components/clients/listForm')
      const { default: UploadClientData } = await import('@/components/settings/UploadClientData')
      const { default: PasteLeadsPanel } = await import('@/components/clients/PasteLeadsPanel')
      const { default: LeadsTableSkeleton } = await import('@/components/clients/LeadsTableSkeleton')
      const matches = [
        { id: 9, name: 'אבי מזרחי', status: 'contacted', phone: '0501234567', email: 'avi@example.test', confidence: 'certain' as const, signals: ['phone', 'idNum'] as ('phone' | 'idNum')[] },
        { id: 10, name: '', status: 'lost', phone: null, email: 'x@example.test', confidence: 'probable' as const, signals: ['email'] as 'email'[] },
      ]
      return shell(
        locale,
        <>
          <ClientFormPop />
          <ClientFormPop client={makeLead({ id: 4, firstName: 'אבי', lastName: 'מזרחי', gender: 'זכר' })} />
          <DuplicateLeadBanner matches={matches} onDismiss={() => {}} />
          <BulkAssignLeadsForm count={7} onAssign={() => {}} onCancel={() => {}} />
          <TransferClientForm client={ROWS[0]} />
          <ListForm />
          <UploadClientData />
          <PasteLeadsPanel />
          <LeadsTableSkeleton />
        </>,
        { search: 'listId=31' },
      )
    },
    allowed: leadsData('אבי מזרחי', 'נציג ראשי'),
  },
  ...LEAD_DETAIL_SURFACES,
  ...LEAD_TABS_SURFACES,
  ...INBOX_SURFACES,
  ...MESSENGER_COMMENTS_SURFACES,
  ...INBOX_MOBILE_SURFACES,
  ...GLOBAL_TASKS_FILES_SURFACES,
  ...CALENDAR_SURFACES,
  ...DEALS_SURFACES,
  ...BILLING_SURFACES,
  ...SETTINGS_SURFACES,
  ...ADMIN_SURFACES,
  ...(
    [
      ['desktop, Today brief v2 + analytics', { mobile: false, v2: true, stats: STATS }, ['דנה כהן', 'דנה', 'יוסי לוי', 'רונית', 'שיחת היכרות', 'יל', 'ר']],
      ['desktop, analytics unavailable', { mobile: false, v2: true, stats: null }, ['דנה כהן', 'דנה', 'יוסי לוי', 'רונית', 'שיחת היכרות', 'יל', 'ר']],
      ['desktop, legacy worklist', { mobile: false, v2: false, stats: STATS }, ['דנה כהן']],
      ['mobile, Today brief v2', { mobile: true, v2: true, stats: STATS }, ['דנה כהן', 'יוסי לוי', 'רונית']],
      ['mobile, legacy worklist', { mobile: true, v2: false, stats: STATS }, ['דנה כהן']],
    ] as const
  ).map(
    ([variant, env, data]): Surface => ({
      name: `dashboard — ${variant}`,
      route: '/dashboard',
      render: async (locale) => {
        Object.assign(dashboardEnv, env)
        const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
        const { default: DashboardPage } = await import('@/components/home/DashboardPage')
        const page = await resolveAsync(await DashboardPage({ searchParams: Promise.resolve({}) }))
        // The (app) layout provides the client-side translator for the same locale.
        return <I18nProvider locale={locale}>{page}</I18nProvider>
      },
      allowed: data.map((text) => {
        if (!DASHBOARD_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
        return { text, reason: 'customer-data' as const }
      }),
    }),
  ),
]
