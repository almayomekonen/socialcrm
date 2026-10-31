/**
 * Mutable fixtures for the trial gate, the card-return page and the support
 * centre (i18n Phase F5). Each test file wires its `vi.mock` factories
 * (trialSupportMocks.ts) to this object; `resetTrialSupportEnv()` restores it.
 * Every server action and navigation is RECORDED in `calls`, so the behaviour
 * tests can replay the same taps in he / en / ar and compare what was sent.
 */

import type { CardSetupState } from '@/lib/payments/cardTrial/setupStatus'

export const NOW = new Date('2026-10-20T09:00:00.000Z')

export const SUPPORT_USER = { id: 7, agencyId: 103, name: 'דנה כהן', email: 'dana@example.com', role: 'ADMIN', suspended: false }

const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000)

export function requestRow(over: Record<string, unknown> = {}) {
  return {
    id: 41,
    agencyId: 103,
    createdByUserId: 7,
    requesterNameSnapshot: 'דנה כהן',
    requesterEmailSnapshot: 'dana@example.com',
    subject: 'הוואטסאפ לא מתחבר',
    kind: 'problem',
    category: 'whatsapp',
    status: 'open',
    context: {},
    diagnostics: {},
    lastMessageAt: at(5),
    lastMessageAuthorKind: 'customer',
    resolvedAt: null,
    createdAt: at(60),
    updatedAt: at(5),
    ...over,
  }
}

/** One of every status, every relative-time band (moments, minutes, hours, yesterday, days). */
export const REQUEST_ROWS = [
  requestRow({ id: 41, status: 'open', lastMessageAt: at(0) }),
  requestRow({ id: 42, subject: 'איך מייבאים לידים?', kind: 'question', status: 'in_progress', lastMessageAt: at(12) }),
  requestRow({ id: 43, subject: 'החיוב לא ברור לי', status: 'waiting_for_customer', lastMessageAt: at(180) }),
  requestRow({ id: 44, subject: 'פנייה חדשה', status: 'resolved', lastMessageAt: at(60 * 30) }),
  requestRow({ id: 45, subject: 'טופס האתר לא שולח', status: 'open', lastMessageAt: at(60 * 24 * 4) }),
]

export const MESSAGE_ROWS = [
  { id: 1, requestId: 41, agencyId: 103, authorKind: 'customer', authorUserId: 7, body: 'הוואטסאפ לא מתחבר\nניסיתי פעמיים', createdAt: at(60) },
  { id: 2, requestId: 41, agencyId: 103, authorKind: 'support', authorUserId: 1, body: 'בודקים את זה עכשיו', createdAt: at(30) },
  { id: 3, requestId: 41, agencyId: 103, authorKind: 'customer', authorUserId: 9, body: 'עדיין לא עובד', createdAt: at(5) },
  { id: 4, requestId: 41, agencyId: 103, authorKind: 'customer', authorUserId: 7, body: '   ', createdAt: at(4) },
]

/** Customer / rep data the support screens show verbatim (leak-gate allowances). */
export const SUPPORT_CUSTOMER_DATA = [
  'דנה כהן',
  'הוואטסאפ לא מתחבר',
  'איך מייבאים לידים?',
  'החיוב לא ברור לי',
  'פנייה חדשה',
  'טופס האתר לא שולח',
  'ניסיתי פעמיים',
  'בודקים את זה עכשיו',
  'עדיין לא עובד',
]

export const VERIFYING: CardSetupState = { state: 'verifying', callbackReceived: false, firstChargeAt: null, chargesEnabled: false, sandbox: false }

const DEFAULTS = () => ({
  user: { ...SUPPORT_USER } as Record<string, unknown> | null,
  /** The stored interface-language preference (`getUiLocalePrefs`). */
  userLocale: null as string | null,
  /** The pre-login `ui_locale` cookie value (`getPreLoginLocale`). */
  cookieLocale: 'he' as 'he' | 'en' | 'ar',
  requests: REQUEST_ROWS.map((r) => ({ ...r })) as Record<string, unknown>[],
  request: requestRow() as Record<string, unknown> | null,
  messages: MESSAGE_ROWS.map((m) => ({ ...m })) as Record<string, unknown>[],
  /** Server action outcomes; a thunk runs when the action is called (rejections, never-settling promises). */
  createResult: { ok: true, requestId: 41 } as unknown,
  replyResult: { ok: true } as unknown,
  startTrial: { ok: true, started: true } as unknown,
  startCardSetup: { ok: true, url: 'https://sandbox.meshulam.co.il/far?l=x' } as unknown,
  setupStatus: VERIFYING as unknown,
  calls: [] as [string, unknown][],
})

export const trialSupportEnv = DEFAULTS()

export function resetTrialSupportEnv() {
  Object.assign(trialSupportEnv, DEFAULTS())
}

export function record(name: string, value?: unknown) {
  trialSupportEnv.calls.push([name, value === undefined ? null : structuredClone(value)])
}
