/**
 * Mutable state behind the /leads and /clients mocks used by the leak gate and
 * the leads locale test (Phase C). Data comes from leadsFixtures.ts — Hebrew
 * customer data on purpose, so the tests prove it reaches the screen untouched.
 */
import { CLIENT_LISTS, ROWS, USERS } from './leadsFixtures'

export const LEADS_DEFAULTS = {
  hasLeads: true,
  rows: ROWS as Record<string, unknown>[],
  /** Meta connection state the page reads (dashboard surfaces keep `connected: false`). */
  meta: { connected: false, needsReconnect: false } as { connected: boolean; needsReconnect?: boolean },
  overQuota: 13,
  /** `deliveryFacts` for the intake banner: one website connection refusing deliveries. */
  intakeFacts: {} as Record<string, unknown>,
  search: '',
}

export const leadsEnv = { ...LEADS_DEFAULTS }

export function resetLeadsEnv() {
  Object.assign(leadsEnv, LEADS_DEFAULTS)
}

/** A connection that has delivered before and now refuses: the banner shows (see isFailingIntake). */
export const FAILING_INTAKE = {
  'contact_form_7:3': {
    eventCount: 57,
    consecutiveRejections: 1,
    lastRejectedAt: '2026-10-28T08:00:00Z',
    lastEventAt: '2026-10-27T08:00:00Z',
    lastRejectionReason: 'invalid_signature',
  },
}

export const LEADS_PAGE_PERMS = { gotPermIds: [], allPermUsers: USERS, gotPermUsers: USERS }

export { CLIENT_LISTS, USERS }

/**
 * Every Hebrew value the list surfaces may render verbatim: lead and user
 * names (and their initials), saved-list titles. A leak-gate allowance must
 * come from this list.
 */
export const LEADS_CUSTOMER_DATA = [
  ...ROWS.map((r) => r.name as string),
  ...ROWS.map((r) => r.userName as string),
  ...CLIENT_LISTS.map((l) => l.title),
  ...USERS.map((u) => u.name),
  'דנה כהן',
]
