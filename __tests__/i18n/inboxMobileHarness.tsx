import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE, INBOX_DEFAULTS, NOW, inboxEnv } from './inboxEnv'
import { inboxShell } from './inboxHarness'

/**
 * The MOBILE inbox (`/inbox` on a phone, `MobileInboxRoute`) the way the (app)
 * layout serves it: the interface-language provider, entitlement and session
 * user around the REAL server page, inside the mobile workspace context (the
 * signal `loading.tsx` / `error.tsx` read). The device gate is mocked to
 * "phone" in each test file; every component, producer and mapper is real.
 * Fixtures are the desktop inbox's (inboxEnv.ts) plus the rows below.
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function mobileShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { MobileWorkspaceContext } = await import('@/components/mobile/MobileWorkspaceContext')
  return inboxShell(locale, <MobileWorkspaceContext.Provider value>{node}</MobileWorkspaceContext.Provider>, ent)
}

export async function mobileInboxPage(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(he)/(app)/inbox/page')
  const sp = inboxEnv.selected ? { conversation: String(inboxEnv.selected.conversationId), ...searchParams } : searchParams
  return resolveAsync(await Page({ searchParams: Promise.resolve(sp) }))
}

/** Build under `overrides`, then restore the defaults other renders expect. */
export async function withMobileEnv<T>(overrides: Partial<typeof INBOX_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(inboxEnv, INBOX_DEFAULTS, { active: true }, overrides)
  try {
    return await build()
  } finally {
    Object.assign(inboxEnv, INBOX_DEFAULTS)
  }
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()

/** How long ago each row's last message was: every relative-time bucket the list shows. */
export const AGES: Record<string, number | null> = {
  future: -5 * MIN,
  seconds: 20_000,
  minute: 61_000,
  minutes: 4 * MIN,
  hour: 61 * MIN,
  hours: 5 * HOUR,
  yesterday: 30 * HOUR,
  days: 3 * DAY,
  // 12:00 UTC on a day well past a week: the same calendar day in UTC and Israel.
  older: NOW - Date.parse('2026-10-14T12:00:00Z'),
  none: null,
}

/** One raw list row per relative-time bucket (names / previews are customer data). */
export const AGE_ROWS = Object.entries(AGES).map(([label, ago], i) => ({
  conversationId: 500 + i,
  leadId: 600 + i,
  channel: 'whatsapp',
  customerName: `לקוח ${i + 1}`,
  leadName: null,
  customerWaId: `97252000000${i}`,
  leadStatus: 'contacted',
  lastMessageAt: ago == null ? null : at(NOW - ago),
  lastInboundAt: null,
  lastHumanOutboundAt: null,
  lastDirection: ago == null ? null : 'inbound',
  lastMessageText: ago == null ? null : `הודעה ${label}`,
  lastReadAt: null,
  temperature: null,
  intent: null,
  suggestedAction: null,
}))

/** A thread whose latest message is 4 minutes old, for the header's recency line. */
export const RECENT_THREAD = [
  {
    id: 401,
    direction: 'inbound',
    type: 'text',
    text: 'אפשר פרטים?',
    timestamp: at(NOW - 4 * MIN),
    status: 'received',
    failureText: null,
    failureCategory: null,
    attachment: null,
  },
]

/** Ready-message titles: owner Hebrew, known slugs, a numbered slug, an unknown slug, empty. */
export const SLUG_TEMPLATES = [
  { title: 'תזכורת פגישה' },
  { title: 'lead_first_contact' },
  { title: 'follow_up_2' },
  { title: 'ready_message' },
  { title: 'promo_october' },
  { title: '' },
  { title: 'Hello there' },
].map(({ title }, i) => ({
  id: 70 + i,
  displayTitle: title,
  status: 'approved',
  bodyText: `גוף הודעה ${i + 1}`,
  variables: [],
  failureText: null,
  archived: false,
  createdAt: at(NOW - 10 * DAY),
}))
