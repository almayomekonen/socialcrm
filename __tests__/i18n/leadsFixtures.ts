/**
 * Fixed data for the /leads and /clients Hebrew baseline. Customer data is
 * Hebrew on purpose: it must reach the screen untouched by any later
 * localization, so the baseline proves it does.
 */

/** Wednesday 28 Oct 2026, 11:00 Asia/Jerusalem. */
export const NOW = Date.parse('2026-10-28T09:00:00Z')
const DAY = 86_400_000
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

export function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'דנה כהן',
    firstName: 'דנה',
    lastName: 'כהן',
    phone: '0501234567',
    status: 'new',
    leadSource: 'manual',
    userName: 'נציג ראשי',
    handlerName: 'מנהל',
    email: 'dana@example.test',
    lead: true,
    createdAt: ago(3),
    updatedAt: ago(0),
    ...overrides,
  }
}

/** Every status, several sources, every "last contact" bucket, one customer row. */
export const ROWS = [
  makeLead({ id: 1, name: 'דנה כהן', status: 'new', leadSource: 'whatsapp:972501234567', updatedAt: ago(0) }),
  makeLead({ id: 2, name: 'יוסי לוי', firstName: 'יוסי', lastName: 'לוי', status: 'new', leadSource: 'facebook:1234567890', updatedAt: ago(1) }),
  makeLead({ id: 3, name: 'מיכל אברהם', status: 'new', leadSource: 'instagram:55', phone: null, updatedAt: ago(5) }),
  makeLead({ id: 4, name: 'אבי מזרחי', status: 'contacted', leadSource: 'contact_form_7:3:c1e76529-dddb-407a-b0a4-3110089b0da4', updatedAt: ago(20) }),
  makeLead({ id: 5, name: 'רונית גבאי', status: 'contacted', leadSource: null, updatedAt: null, createdAt: ago(2) }),
  makeLead({ id: 6, name: 'שי פרץ', status: 'interested', leadSource: 'utm_campaign_spring', updatedAt: ago(7) }),
  makeLead({ id: 7, name: 'נועה ביטון', status: 'closed', leadSource: 'manual', lead: false, updatedAt: ago(30) }),
  makeLead({ id: 8, name: 'עומר דהן', status: 'lost', leadSource: 'website', updatedAt: ago(14) }),
]

/**
 * A saved column preference as it is stored per user: the Hebrew `label` is
 * persisted inside the object, and `phone` carries an older label than today's
 * header. Whatever the table does with stored labels must not change.
 */
export const TBL_PREF_USER = {
  id: 9001,
  agencyId: 103,
  name: 'דנה כהן',
  tblPref: {
    leadsTable435: [
      { key: 'status', label: 'סטטוס', format: 'formatStatus' },
      { key: 'name', label: 'שם מלא', format: 'formatName' },
      { key: 'phone', label: 'טלפון' },
      { key: 'leadSource', label: 'מקור', format: 'formatLeadSource' },
      { key: 'email', label: 'מייל', noShow: true },
      { key: 'removedColumn', label: 'עמודה ישנה' },
    ],
  },
}

export const USERS = [
  { id: 11, name: 'רועי נציג', email: 'roi@example.test' },
  { id: 12, name: 'שרה נציגה', email: 'sara@example.test' },
]

export const CLIENT_LISTS = [
  { id: 31, title: 'לקוחות חמים', clientIds: [1, 2, 3] },
  { id: 32, title: 'מהקמפיין', clientIds: [4] },
]
