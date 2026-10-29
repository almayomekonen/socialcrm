/**
 * Fixed data + mutable state behind the lead TABS mocks
 * (`/clients/[clientId]/{tasks,tasks/[taskId],files,billing}`): the Hebrew
 * baseline, the leak gate, the locale and behaviour tests. Customer data is
 * Hebrew on purpose — it must reach the screen untouched by any localization.
 * Task statuses are STORED Hebrew values (the `tasks.status` column), so they
 * are listed here as the values the screen receives, not as interface text.
 */
import { NOW } from './leadsFixtures'

export { NOW }

const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString()

export const TABS_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

/** Every stored task status (`SelectTasksStatus.statusOptions`). */
export const TASK_STATUSES = ['חדש', 'בטיפול', 'ממתין לתשובה', 'הועבר לנציג אחר', 'לא רלוונטי', 'לא מעוניין', 'סגורה', 'הסתיים טיפול']

const task = (id: number, title: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  clientId: 41,
  title,
  status,
  userId: 12,
  userName: 'מנהל ראשי',
  completed: false,
  dueDate: at(NOW + id * DAY),
  createdAt: at(NOW - 10 * DAY),
  updatedAt: at(NOW - DAY),
  notes: [],
  ...extra,
})

/** One row per stored status; row 1 overdue, row 7 done (and past due), row 8 without a handler. */
export const TASK_ROWS = [
  task(1, 'לשלוח הצעת מחיר', TASK_STATUSES[0], { dueDate: at(NOW - 2 * DAY) }),
  task(2, 'שיחת המשך', TASK_STATUSES[1]),
  task(3, 'לבדוק תקציב', TASK_STATUSES[2]),
  task(4, 'להעביר לצוות', TASK_STATUSES[3]),
  task(5, 'לסגור תיק', TASK_STATUSES[4]),
  task(6, 'לתאם פגישה', TASK_STATUSES[5]),
  task(7, 'לשלוח חוזה', TASK_STATUSES[6], { completed: true, dueDate: at(NOW - 3 * DAY) }),
  task(8, 'לעדכן פרטים', TASK_STATUSES[7], { userId: null, userName: null }),
]

export const TASK_TMPLTS = [
  { id: 301, title: 'תבנית קליטת ליד' },
  { id: 302, title: 'תבנית מעקב חודשי' },
]

export const PERM_USERS = [
  { id: 12, name: 'מנהל ראשי' },
  { id: 13, name: 'רון נציג' },
]

export const NOTES = [
  { userName: 'דנה כהן', content: 'הלקוח ביקש לחזור בשבוע הבא', createdAt: at(NOW - 2 * DAY) },
  { userName: 'רון נציג', content: 'נשלח מייל עם פרטים', createdAt: at(NOW - DAY) },
]

export const TASK_DETAIL = { ...TASK_ROWS[1], notes: NOTES, files: [] }

export const FILE_ROWS = [
  { id: 71, clientId: 41, name: 'חוזה_חתום.pdf', type: 'application/pdf', size: 2_500_000, url: 'https://files.example.test/a.pdf', taskId: 2, taskTitle: 'שיחת המשך', createdAt: at(NOW - 5 * DAY), createdByName: 'דנה כהן' },
  { id: 72, clientId: 41, name: 'צילום_תעודה.jpg', type: 'image/jpeg', size: 800_000, url: 'https://files.example.test/b.jpg', taskId: null, taskTitle: null, createdAt: at(NOW - 2 * DAY), createdByName: 'רון נציג' },
  { id: 73, clientId: 41, name: 'הצעה.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 40_000, url: 'https://files.example.test/c.docx', taskId: null, taskTitle: null, createdAt: at(NOW - DAY), createdByName: null },
]

export const DRIVE_ATTACHMENTS = [
  { id: 801, driveFileId: 'd-1', name: 'סיכום פגישה', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://drive.example.test/1', createdAt: at(NOW - 4 * DAY) },
  { id: 802, driveFileId: 'd-2', name: 'מצגת הצעה', mimeType: 'application/vnd.google-apps.presentation', webViewLink: null, createdAt: at(NOW - 3 * DAY) },
]

export const DRIVE_SUGGESTIONS = [
  { driveFileId: 's-1', name: 'יוסי לוי - טופס', mimeType: 'application/pdf', modifiedTime: '2026-10-20T10:00:00.000Z', webViewLink: 'https://drive.example.test/s1', thumbnailLink: null },
]

const invoice = (id: number, docState: string, fulfillState: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  agencyId: 103,
  leadId: 41,
  docState,
  fulfillState,
  kind: 'invoice',
  documentNumber: docState === 'draft' ? null : 40 + id,
  documentYear: docState === 'draft' ? null : 2026,
  issuedAt: docState === 'draft' ? null : at(NOW - id * DAY),
  dueAt: docState === 'draft' ? null : at(NOW + id * DAY),
  createdAt: at(NOW - 20 * DAY),
  updatedAt: at(NOW - DAY),
  currency: 'ILS',
  totalAmount: 1000 * id + 0.5,
  ...extra,
})

/** Every document state and every fulfilment state, both kinds. */
export const INVOICES = [
  invoice(1, 'draft', null),
  invoice(2, 'issued', 'open'),
  invoice(3, 'issued', 'partial', { kind: 'invoice_receipt' }),
  invoice(4, 'issued', 'paid', { kind: 'invoice_receipt', dueAt: null }),
  invoice(5, 'issued', 'overdue'),
  invoice(6, 'voided', 'written_off'),
  invoice(7, 'replaced', null),
]

export type PickerStatus = 'idle' | 'loading' | 'open' | 'error' | 'unconfigured'

export const TABS_DEFAULTS = {
  pathname: '/clients/41/tasks',
  user: TABS_USER as Record<string, unknown>,
  tasks: TASK_ROWS as Record<string, unknown>[],
  taskTmplts: TASK_TMPLTS as { id: number; title: string }[],
  taskDetail: TASK_DETAIL as Record<string, unknown> | null,
  files: FILE_ROWS as Record<string, unknown>[],
  attachments: DRIVE_ATTACHMENTS as Record<string, unknown>[],
  suggestions: DRIVE_SUGGESTIONS as Record<string, unknown>[],
  /** `DRIVE_PICKER_ENABLED`. */
  pickerEnabled: false,
  pickerStatus: 'idle' as PickerStatus,
  invoices: INVOICES as Record<string, unknown>[],
  /** Whether the lead-access read on the billing page finds the lead. */
  leadFound: true,
  /** Product access on the server; the client side reads EntitlementProvider. */
  hasAccess: true,
}

export const tabsEnv = { ...TABS_DEFAULTS }

export function resetTabsEnv() {
  Object.assign(tabsEnv, TABS_DEFAULTS)
}

export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T12:00:00.000Z' }
export const ACTIVE = { hasAccess: true, status: 'ACTIVE', expiresAt: null }

/** Hebrew customer data the tab screens render verbatim (titles, names, notes, file names). */
export const TABS_CUSTOMER_DATA = [
  ...TASK_ROWS.map((t) => t.title),
  ...TASK_TMPLTS.map((t) => t.title),
  ...PERM_USERS.map((u) => u.name),
  ...NOTES.map((n) => n.content),
  'דנה כהן',
  ...FILE_ROWS.map((f) => f.name),
  ...DRIVE_ATTACHMENTS.map((f) => f.name),
  ...DRIVE_SUGGESTIONS.map((f) => f.name),
]

/** Stored task-status values (data in `tasks.status`); shown verbatim in Hebrew, labelled elsewhere. */
export const TABS_STORED_VALUES = TASK_STATUSES
