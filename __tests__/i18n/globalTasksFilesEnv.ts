/**
 * Fixed data + mutable state behind the GLOBAL /tasks and /files mocks (Phase E1):
 * the Hebrew baseline, the leak gate, the locale and behaviour tests. Customer
 * data (task titles, lead names, rep names, file names) is Hebrew on purpose —
 * it must reach the screen untouched by any localization. Task statuses are
 * STORED Hebrew values (`tasks.status`), reused from the lead-tabs fixtures.
 */
import { NOW, TASK_STATUSES } from './leadTabsEnv'

export { NOW, TASK_STATUSES }

const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString()

export const GLOBAL_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103, tblPref: null as unknown }

export const GOT_PERM_USERS = [{ id: 7, name: 'דנה כהן' }, { id: 12, name: 'מנהל ראשי' }]
export const GAVE_PERM_USERS = [{ id: 13, name: 'רון נציג' }]

const task = (id: number, title: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  clientId: 40 + id,
  clientName: `ליד ${['יוסי', 'מירב', 'אבי'][id % 3]}`,
  title,
  status,
  userId: 12,
  userName: 'מנהל ראשי',
  completed: false,
  dueDate: at(NOW + id * DAY),
  createdAt: at(NOW - 10 * DAY),
  updatedAt: at(NOW - DAY),
  ...extra,
})

/** One row per stored status; row 1 overdue, row 7 done (and past due), row 8 without a handler. */
export const GLOBAL_TASKS = [
  task(1, 'לשלוח הצעת מחיר', TASK_STATUSES[0], { dueDate: at(NOW - 2 * DAY) }),
  task(2, 'שיחת המשך', TASK_STATUSES[1]),
  task(3, 'לבדוק תקציב', TASK_STATUSES[2]),
  task(4, 'להעביר לצוות', TASK_STATUSES[3]),
  task(5, 'לסגור תיק', TASK_STATUSES[4]),
  task(6, 'לתאם פגישה', TASK_STATUSES[5]),
  task(7, 'לשלוח חוזה', TASK_STATUSES[6], { completed: true, dueDate: at(NOW - 3 * DAY) }),
  task(8, 'לעדכן פרטים', TASK_STATUSES[7], { userId: null, userName: null }),
]

export const GLOBAL_TMPLTS = [{ id: 301, title: 'תבנית קליטת ליד' }]

export const GLOBAL_FILES = [
  { id: 71, clientId: 41, clientName: 'יוסי לוי', name: 'חוזה_חתום.pdf', type: 'application/pdf', size: 2_500_000, url: 'https://files.example.test/a.pdf', taskId: 2, taskTitle: 'שיחת המשך', createdAt: at(NOW - 5 * DAY), createdByName: 'דנה כהן' },
  { id: 72, clientId: 42, clientName: 'מירב כהן', name: 'צילום_תעודה.jpg', type: 'image/jpeg', size: 800_000, url: 'https://files.example.test/b.jpg', taskId: null, taskTitle: null, createdAt: at(NOW - 2 * DAY), createdByName: 'רון נציג' },
  { id: 73, clientId: 41, clientName: 'יוסי לוי', name: 'הצעה.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 40_000, url: 'https://files.example.test/c.docx', taskId: null, taskTitle: null, createdAt: at(NOW - DAY), createdByName: null },
  { id: 74, clientId: null, clientName: null, name: 'נתונים.xlsx', type: 'application/vnd.ms-excel', size: 120_000_000, url: 'https://files.example.test/d.xlsx', taskId: null, taskTitle: null, createdAt: at(NOW - 3 * DAY), createdByName: 'דנה כהן' },
]

export const GLOBAL_DEFAULTS = {
  user: GLOBAL_USER as Record<string, unknown>,
  tasks: GLOBAL_TASKS as Record<string, unknown>[],
  taskTmplts: GLOBAL_TMPLTS as { id: number; title: string }[],
  leadsByRep: [] as Record<string, unknown>[],
  files: GLOBAL_FILES as Record<string, unknown>[],
  /** The last filter `getTasks` received (the page passes the URL filter through). */
  lastFilter: null as unknown,
}

export const globalEnv = { ...GLOBAL_DEFAULTS }

export function resetGlobalEnv() {
  Object.assign(globalEnv, GLOBAL_DEFAULTS, { lastFilter: null })
}

/** Hebrew customer data the global pages render verbatim. */
export const GLOBAL_CUSTOMER_DATA = [
  ...GLOBAL_TASKS.map((t) => t.title),
  ...GLOBAL_TASKS.map((t) => t.clientName),
  ...GLOBAL_TMPLTS.map((t) => t.title),
  ...GOT_PERM_USERS.map((u) => u.name),
  ...GAVE_PERM_USERS.map((u) => u.name),
  ...GLOBAL_FILES.map((f) => f.name),
  ...GLOBAL_FILES.map((f) => f.clientName).filter(Boolean),
  'שיחת המשך',
  'דנה כהן',
  'רון נציג',
] as string[]
