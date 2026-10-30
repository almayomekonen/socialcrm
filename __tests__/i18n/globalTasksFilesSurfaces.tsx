import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import { GLOBAL_CUSTOMER_DATA, GLOBAL_FILES, GLOBAL_TASKS } from './globalTasksFilesEnv'
import { globalFilesPage, globalShell, globalTasksPage, withGlobalEnv } from './globalTasksFilesHarness'
import { TASK_TMPLTS } from './leadTabsEnv'
import { withTabsEnv } from './leadTabsHarness'

/**
 * Leak-gate registrations for the GLOBAL /tasks and /files pages (Phase E1,
 * desktop). Spread into SURFACES (surfaces.tsx); rendering relies on the mocks
 * in leakGate.test.tsx. The delete confirmation (portalled) is scanned in
 * globalTasksFilesLocales.test.tsx, where it is opened. Task templates come
 * from the gate's shared `getTaskTmplts` mock (the lead-tabs fixtures).
 */

function globalData(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!GLOBAL_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as global tasks/files customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

const LEAD_NAMES = [...new Set(GLOBAL_TASKS.map((t) => t.clientName))]
const FILE_LEADS = [...new Set(GLOBAL_FILES.map((f) => f.clientName).filter(Boolean))] as string[]

export const GLOBAL_TASKS_FILES_SURFACES: Surface[] = [
  {
    name: 'global tasks — every stored status, overdue, done, no handler; filters, footer, add-task popover',
    route: '/tasks',
    render: async (locale) => globalShell(locale, await withGlobalEnv({}, () => globalTasksPage())),
    allowed: [
      ...globalData(...GLOBAL_TASKS.map((t) => t.title), ...LEAD_NAMES, 'מנהל ראשי'),
      ...TASK_TMPLTS.map((t) => ({ text: t.title, reason: 'customer-data' as const })),
    ],
  },
  {
    name: 'global tasks — no tasks, no templates',
    route: '/tasks',
    render: async (locale) =>
      globalShell(locale, await withTabsEnv({ taskTmplts: [] }, () => withGlobalEnv({ tasks: [], taskTmplts: [] }, () => globalTasksPage()))),
    allowed: [],
  },
  {
    name: 'global files — every file type, task link, lead link, no lead; filters',
    route: '/files',
    render: async (locale) => globalShell(locale, await withGlobalEnv({}, () => globalFilesPage())),
    allowed: globalData(...GLOBAL_FILES.map((f) => f.name), ...FILE_LEADS, 'שיחת המשך', 'דנה כהן', 'רון נציג'),
  },
  {
    name: 'global files — empty',
    route: '/files',
    render: async (locale) => globalShell(locale, await withGlobalEnv({ files: [] }, () => globalFilesPage())),
    allowed: [],
  },
]
