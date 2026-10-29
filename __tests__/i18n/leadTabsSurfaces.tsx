import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import {
  DRIVE_ATTACHMENTS,
  DRIVE_SUGGESTIONS,
  EXPIRED,
  FILE_ROWS,
  NOTES,
  PERM_USERS,
  TABS_CUSTOMER_DATA,
  TASK_DETAIL,
  TASK_ROWS,
  TASK_TMPLTS,
} from './leadTabsEnv'
import { billingPage, filesPage, tabsShell, taskDetailPage, tasksPage, withTabsEnv } from './leadTabsHarness'

/**
 * Leak-gate registrations for the lead TABS (Phase C, desktop):
 * /clients/[clientId]/{tasks, tasks/[taskId], files, billing}. Spread into
 * SURFACES (surfaces.tsx); rendering relies on the mocks in leakGate.test.tsx.
 * Portalled dialogs (Drive attach, document kind, confirmations) are scanned
 * in leadTabsLocales.test.tsx, where they are opened.
 */

/** A tabs allowance: only declared fixture customer data may be allowed. */
function tabsData(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!TABS_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as lead-tabs customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

const TASK_TITLES = TASK_ROWS.map((t) => t.title)
const HANDLER = PERM_USERS[0].name
const FILE_NAMES = FILE_ROWS.map((f) => f.name)
const UPLOADERS = ['דנה כהן', 'רון נציג']
const DRIVE_NAMES = DRIVE_ATTACHMENTS.map((f) => f.name)

export const LEAD_TABS_SURFACES: Surface[] = [
  {
    name: 'lead tasks tab — every stored status, overdue, done, filters, add-task popover with templates',
    route: '/clients/[clientId]/tasks',
    render: async (locale) => tabsShell(locale, await withTabsEnv({}, () => tasksPage())),
    allowed: tabsData(...TASK_TITLES, HANDLER, ...TASK_TMPLTS.map((t) => t.title)),
  },
  {
    name: 'lead tasks tab — no tasks, no templates',
    route: '/clients/[clientId]/tasks',
    render: async (locale) => tabsShell(locale, await withTabsEnv({ tasks: [], taskTmplts: [] }, () => tasksPage())),
    allowed: [],
  },
  {
    name: 'lead task detail — header, status, rep, context menu, title form, notes',
    route: '/clients/[clientId]/tasks/[taskId]',
    render: async (locale) => tabsShell(locale, await withTabsEnv({}, () => taskDetailPage())),
    allowed: tabsData(TASK_DETAIL.title, ...NOTES.map((n) => n.content), ...NOTES.map((n) => n.userName)),
  },
  {
    name: 'lead task detail — completed, no notes',
    route: '/clients/[clientId]/tasks/[taskId]',
    render: async (locale) =>
      tabsShell(
        locale,
        await withTabsEnv({ taskDetail: { ...TASK_DETAIL, completed: true, notes: [] } }, () => taskDetailPage()),
      ),
    allowed: tabsData(TASK_DETAIL.title),
  },
  {
    name: 'lead files tab — files of every type, task link, upload form, Drive attachments + suggestions',
    route: '/clients/[clientId]/files',
    render: async (locale) => tabsShell(locale, await withTabsEnv({}, () => filesPage())),
    allowed: tabsData(...FILE_NAMES, TASK_DETAIL.title, ...UPLOADERS, ...DRIVE_NAMES, DRIVE_SUGGESTIONS[0].name),
  },
  {
    name: 'lead files tab — Drive Picker enabled (re-pick), no files',
    route: '/clients/[clientId]/files',
    render: async (locale) => {
      process.env.DRIVE_PICKER_ENABLED = 'true'
      try {
        return tabsShell(locale, await withTabsEnv({ files: [] }, () => filesPage()))
      } finally {
        delete process.env.DRIVE_PICKER_ENABLED
      }
    },
    allowed: tabsData(...DRIVE_NAMES),
  },
  {
    name: 'lead files tab — empty files and Drive',
    route: '/clients/[clientId]/files',
    render: async (locale) =>
      tabsShell(locale, await withTabsEnv({ files: [], attachments: [], suggestions: [] }, () => filesPage())),
    allowed: [],
  },
  {
    name: 'lead files tab — expired subscription: uploader and Drive attach locked',
    route: '/clients/[clientId]/files',
    render: async (locale) => tabsShell(locale, await withTabsEnv({ hasAccess: false }, () => filesPage()), EXPIRED),
    allowed: tabsData(...FILE_NAMES, TASK_DETAIL.title, ...UPLOADERS, ...DRIVE_NAMES),
  },
  {
    name: 'lead billing tab — every document and fulfilment state, both kinds',
    route: '/clients/[clientId]/billing',
    render: async (locale) => tabsShell(locale, await withTabsEnv({}, () => billingPage())),
    allowed: [],
  },
  {
    name: 'lead billing tab — empty: may create, may not create',
    route: '/clients/[clientId]/billing',
    render: async (locale) => {
      const canCreate = await withTabsEnv({ invoices: [] }, () => billingPage())
      // A role that may not draft (EXT): the list itself, as the page renders it for that role.
      const { default: LeadBillingList } = await import('@/components/billing/LeadBillingList')
      return tabsShell(
        locale,
        <>
          {canCreate}
          <LeadBillingList leadId={41} invoices={[]} canCreate={false} locale={locale} />
        </>,
      )
    },
    allowed: [],
  },
]
