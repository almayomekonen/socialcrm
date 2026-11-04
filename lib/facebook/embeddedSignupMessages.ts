// Imported from the PURE events module, never from `coexistence.ts`: this file
// is reachable from `useEmbeddedSignup` ('use client'), and importing the
// server-only module here pulls db/auth.ts and knex into the browser bundle.
import {
  EMBEDDED_SIGNUP_STEPS,
  ES_EVENT_CANCEL,
  ES_EVENT_ERROR,
  ES_EVENT_FINISH,
  ES_EVENT_FINISH_COEXISTENCE,
  ES_EVENT_FINISH_ONLY_WABA,
  META_SIGNUP_EVENTS,
  metaErrorId,
  metaPayloadKeys,
  metaSessionId,
  metaTimestamp,
  metaTraceId,
  type EmbeddedSignupStep,
  type MetaSignupEvent,
  type OnboardingType,
} from '@/lib/whatsapp/coexistenceEvents'

/**
 * Reading what Meta's Embedded Signup window posts to this page. Values come
 * from another window, so everything is checked and bounded here. The gate that
 * acts on the result lives in embeddedSignupSession.ts.
 */

const FB_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'web.facebook.com', 'business.facebook.com'])

export type EmbeddedSignupSession = {
  waba_id?: string
  /**
   * Several accounts came back (`messaging_account_ids` or `waba_ids`). Choosing
   * here would be a guess, so they go to the server, which asks Graph which one
   * holds the number.
   */
  wabaCandidates?: string[]
  phone_number_id?: string
  onboardingType: OnboardingType
}

/**
 * Why Meta says the flow did not finish: the screen the customer left on, or an
 * error Meta showed them and they reported from inside the flow.
 */
export type EmbeddedSignupCancel = {
  step?: EmbeddedSignupStep
  errorReported: boolean
  /** Meta's own wording, shown to the customer. Cleaned and bounded. */
  errorMessage?: string
  /** Meta's numeric support id for the report. Stored. */
  errorId?: string
  /**
   * Meta's opaque id for this Embedded Signup session, for a Meta support
   * ticket. Stored. Not a credential and not customer data.
   */
  sessionId?: string
  /** Not in Meta's documented shape; kept only if Meta sends one. */
  traceId?: string
  /** Meta's report time, unix milliseconds as a string. */
  timestamp?: string
}

/**
 * The safe outline of one Meta message: which event, which field names, and two
 * non-identifying facts. Field VALUES are never included, so an undocumented
 * payload can be diagnosed without storing whatever it happens to contain.
 */
export type EmbeddedSignupMessageShape = {
  metaEvent: MetaSignupEvent
  metaPayloadKeys: string[]
  isOnBizApp?: boolean
  accountCount?: number
}

/**
 * Meta's sample accepts any origin where `origin.endsWith('facebook.com')`,
 * which also matches `https://evilfacebook.com`. Exact hosts, or a true
 * `*.facebook.com` subdomain, over HTTPS.
 */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'https:') return false
    return FB_HOSTS.has(hostname) || hostname.endsWith('.facebook.com')
  } catch {
    return false
  }
}

/** A `WA_EMBEDDED_SIGNUP` message from a Facebook origin, or null. */
function readSignupMessage(origin: string, data: unknown): Record<string, unknown> | null {
  if (!isFacebookOrigin(origin)) return null
  let parsed: unknown = data
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const msg = parsed as Record<string, unknown>
  return msg.type === 'WA_EMBEDDED_SIGNUP' ? msg : null
}

const dataOf = (msg: Record<string, unknown>) => (msg.data && typeof msg.data === 'object' ? msg.data : {}) as Record<string, unknown>

const stringIds = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.length > 0) : [])

/** Every account id in a finish message, without duplicates. */
function accountIds(d: Record<string, unknown>): string[] {
  const single = typeof d.waba_id === 'string' && d.waba_id ? [d.waba_id] : []
  return [...new Set([...single, ...stringIds(d.messaging_account_ids), ...stringIds(d.waba_ids)])]
}

const MAX_META_ERROR_LENGTH = 300
const STEP_SET = new Set<string>(EMBEDDED_SIGNUP_STEPS)
const EVENT_SET = new Set<string>(META_SIGNUP_EVENTS)
// C0/C1 controls, and the bidi marks, embeddings, overrides and isolates that
// could reorder the surrounding Hebrew line. Plain text is all that is kept.
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g

/** Meta's error text as one bounded line of plain text; empty when nothing is left. */
function cleanMetaText(raw: string): string {
  return raw.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_META_ERROR_LENGTH)
}

/**
 * Meta's CANCEL message: `{ data: { current_step } }` when the customer left a
 * screen. Its ERROR message: `{ data: { error_message, error_code, session_id,
 * timestamp } }` when they reported an error Meta showed them; older CANCEL
 * payloads carried the same fields. An ERROR event counts as reported even with
 * no usable text, so its ids are never mistaken for a plain cancel.
 */
export function parseEmbeddedSignupCancel(origin: string, data: unknown): EmbeddedSignupCancel | null {
  const msg = readSignupMessage(origin, data)
  if (!msg || (msg.event !== ES_EVENT_CANCEL && msg.event !== ES_EVENT_ERROR)) return null
  const d = dataOf(msg)

  const errorMessage = typeof d.error_message === 'string' ? cleanMetaText(d.error_message) : ''
  const cancel: EmbeddedSignupCancel = errorMessage
    ? { errorReported: true, errorMessage }
    : { errorReported: msg.event === ES_EVENT_ERROR }
  if (!errorMessage && typeof d.current_step === 'string') {
    cancel.step = (STEP_SET.has(d.current_step) ? d.current_step : 'OTHER') as EmbeddedSignupStep
  }
  // Meta's docs now say `error_code`; older payloads used `error_id`.
  const errorId = metaErrorId(d.error_code) ?? metaErrorId(d.error_id)
  if (errorId) cancel.errorId = errorId
  const sessionId = metaSessionId(d.session_id)
  if (sessionId) cancel.sessionId = sessionId
  const traceId = metaTraceId(d.trace_id) ?? metaTraceId(d.fbtrace_id)
  if (traceId) cancel.traceId = traceId
  const timestamp = metaTimestamp(d.timestamp)
  if (timestamp) cancel.timestamp = timestamp
  return cancel
}

export function parseEmbeddedSignupMessage(origin: string, data: unknown): EmbeddedSignupSession | null {
  const msg = readSignupMessage(origin, data)
  if (!msg) return null
  if (msg.event !== ES_EVENT_FINISH && msg.event !== ES_EVENT_FINISH_COEXISTENCE && msg.event !== ES_EVENT_FINISH_ONLY_WABA) return null
  const d = dataOf(msg)
  // v4 sends `waba_id`; v5 sends `messaging_account_ids` ("Replaces waba_id");
  // multi-account flows send `waba_ids`. One id is used directly.
  const ids = accountIds(d)
  const session: EmbeddedSignupSession = {
    waba_id: ids.length === 1 ? ids[0] : undefined,
    phone_number_id: typeof d.phone_number_id === 'string' ? d.phone_number_id : undefined,
    onboardingType: msg.event === ES_EVENT_FINISH_COEXISTENCE ? 'coexistence' : 'cloud_api',
  }
  if (ids.length > 1) session.wabaCandidates = ids
  return session
}

/** The outline of any Embedded Signup message, for diagnostics; null for anything else. */
export function parseEmbeddedSignupShape(origin: string, data: unknown): EmbeddedSignupMessageShape | null {
  const msg = readSignupMessage(origin, data)
  if (!msg) return null
  const d = dataOf(msg)
  const shape: EmbeddedSignupMessageShape = {
    metaEvent: (typeof msg.event === 'string' && EVENT_SET.has(msg.event) ? msg.event : 'OTHER') as MetaSignupEvent,
    metaPayloadKeys: metaPayloadKeys(Object.keys(d)),
  }
  if (typeof d.is_on_biz_app === 'boolean') shape.isOnBizApp = d.is_on_biz_app
  const count = accountIds(d).length
  if (count > 0) shape.accountCount = count
  return shape
}
