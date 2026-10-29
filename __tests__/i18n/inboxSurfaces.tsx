import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import {
  CLOSED_THREAD,
  EXPIRED,
  HANDOFF,
  INBOX_CUSTOMER_DATA,
  INBOX_EXTERNAL,
  LIST_ROWS,
  OPERATOR_TAKE,
  QUESTIONNAIRE_FIELDS,
  SELECTED_LEAD,
  SELECTED_LEADLESS,
  THREAD_CONTENT,
  UNKNOWN_THREAD,
  inboxEnv,
} from './inboxEnv'
import { inboxLoading, inboxPage, inboxShell, withInboxEnv } from './inboxHarness'
import { INTELLIGENCE } from './leadDetailEnv'

/**
 * Leak-gate registrations for the desktop WhatsApp inbox (`/inbox`, Phase D).
 * Spread into SURFACES (surfaces.tsx); rendering relies on the mocks in
 * leakGate.test.tsx. Menus, dialogs, tooltips and toasts are opened and
 * scanned in inboxLocales.test.tsx.
 */

/** An inbox allowance: only declared fixture data — the customer's own, or AI-written (D3) — may be allowed. */
function inboxData(...texts: string[]): Allowance[] {
  return [...new Set(texts)].map((text) => {
    if (INBOX_CUSTOMER_DATA.includes(text)) return { text, reason: 'customer-data' as const }
    if (INBOX_EXTERNAL.includes(text)) return { text, reason: 'external' as const }
    throw new Error(`not declared as inbox fixture data: ${text}`)
  })
}

const NAMES = ['יוסי לוי', 'רונית כהן', 'משה אברהם', 'שרה מזרחי']
const INITIALS = ['יל', 'רכ', 'מא', 'שמ']
const PREVIEWS = LIST_ROWS.map((r) => r.lastMessageText).filter((v): v is string => typeof v === 'string')
/** The list pane (shown with every selection). */
const LIST = [...NAMES, ...INITIALS, ...PREVIEWS]
/** The lead intelligence card's AI text (the lead-detail fixture's; D3). */
const LEAD_INTEL_AI: Allowance[] = [
  INTELLIGENCE.summary,
  ...INTELLIGENCE.keyInsights,
  INTELLIGENCE.suggestedNextAction.title,
  INTELLIGENCE.suggestedNextAction.reason,
].map((text) => ({ text, reason: 'external' as const }))

const page = (overrides: Partial<typeof inboxEnv> = {}, ent?: typeof EXPIRED) => async (locale: 'he' | 'en' | 'ar') =>
  inboxShell(locale, await withInboxEnv(overrides, () => inboxPage()), ent)

export const INBOX_SURFACES: Surface[] = [
  {
    name: 'inbox — populated list, nothing selected: toolbar, smart sections, channel switch, rows, empty workspace',
    route: '/inbox',
    render: page(),
    allowed: inboxData(...LIST),
  },
  {
    name: 'inbox — no conversations at all',
    route: '/inbox',
    render: page({ rows: [], smartCounts: { hot: 0, attention: 0, demo: 0, escalation: 0 }, messengerEnabled: false }),
    allowed: [],
  },
  {
    name: 'inbox — lead thread: every bubble kind and status, failures, reactions, quotes, media, text composer, handoff line, operator take, analysis',
    route: '/inbox',
    render: page({ selected: SELECTED_LEAD, intel: 'fresh', ownership: 'handoff', operatorTake: OPERATOR_TAKE }),
    allowed: [...inboxData(...LIST, ...THREAD_CONTENT, HANDOFF.businessType, HANDOFF.need, HANDOFF.urgency, ...INBOX_EXTERNAL), ...LEAD_INTEL_AI],
  },
  {
    name: 'inbox — leadless contact: header actions, no composer',
    route: '/inbox',
    render: page({ selected: SELECTED_LEADLESS }),
    allowed: inboxData(...LIST, ...THREAD_CONTENT),
  },
  {
    name: 'inbox — window closed with ready messages; questionnaire handoff with its own questions',
    route: '/inbox',
    render: page({
      selected: SELECTED_LEAD,
      messages: CLOSED_THREAD,
      ownership: 'handoff',
      handoff: { ...HANDOFF, urgency: null, fields: QUESTIONNAIRE_FIELDS },
    }),
    allowed: [...inboxData(...LIST, ...CLOSED_THREAD.map((m) => m.text as string), ...QUESTIONNAIRE_FIELDS.flatMap((f) => [f.label, f.value])), ...LEAD_INTEL_AI],
  },
  {
    name: 'inbox — window closed without ready messages; window unknown; agent / human / paused ownership',
    route: '/inbox',
    render: async (locale) => (
      <>
        {await page({ selected: SELECTED_LEAD, messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: [] }, ownership: 'agent' })(locale)}
        {await page({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, ownership: 'human' })(locale)}
        {await page({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, ownership: 'paused' })(locale)}
      </>
    ),
    allowed: [...inboxData(...LIST, ...CLOSED_THREAD.map((m) => m.text as string), ...UNKNOWN_THREAD.map((m) => m.text as string)), ...LEAD_INTEL_AI],
  },
  {
    name: 'inbox — every blocked connection health in the composer; no composer facts',
    route: '/inbox',
    render: async (locale) => {
      // Built one after another: each build sets the shared fixture state.
      const out = []
      for (const health of ['disconnected', 'unknown', 'token', 'webhook', 'registration_pending', 'restricted', 'throttled']) {
        out.push(await page({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health } })(locale))
      }
      out.push(await page({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: null, ownership: 'questionnaire' })(locale))
      return <>{out.map((node, i) => <div key={i}>{node}</div>)}</>
    },
    allowed: [...inboxData(...LIST, ...UNKNOWN_THREAD.map((m) => m.text as string)), ...LEAD_INTEL_AI],
  },
  {
    name: 'inbox — expired subscription: composer, draft and contact actions locked',
    route: '/inbox',
    render: async (locale) => (
      <>
        {await page({ selected: SELECTED_LEAD }, EXPIRED)(locale)}
        {await page({ selected: SELECTED_LEADLESS }, EXPIRED)(locale)}
      </>
    ),
    allowed: [...inboxData(...LIST, ...THREAD_CONTENT), ...LEAD_INTEL_AI],
  },
  {
    name: 'inbox — conversation analysis pending / stale / failed, lead intelligence card',
    route: '/inbox',
    render: async (locale) => (
      <>
        {await page({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, intel: 'pending' })(locale)}
        {await page({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, intel: 'stale' })(locale)}
        {await page({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, intel: 'failed' })(locale)}
      </>
    ),
    // The lead intelligence card's AI text is the lead-detail fixture's (D3).
    allowed: [...inboxData(...LIST, ...UNKNOWN_THREAD.map((m) => m.text as string), ...INBOX_EXTERNAL.slice(0, 2)), ...LEAD_INTEL_AI],
  },
  {
    name: 'inbox — route loading skeleton',
    route: '/inbox (loading)',
    render: async (locale) => inboxShell(locale, await inboxLoading()),
    allowed: [],
  },
]
