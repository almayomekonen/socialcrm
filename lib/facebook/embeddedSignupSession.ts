// Imported from the PURE events module, never from `coexistence.ts`: this file
// is reachable from `useEmbeddedSignup` ('use client'), and importing the
// server-only module here pulls db/auth.ts and knex into the browser bundle.
import {
  EMBEDDED_SIGNUP_STEPS,
  ES_EVENT_CANCEL,
  ES_EVENT_FINISH,
  ES_EVENT_FINISH_COEXISTENCE,
  metaErrorId,
  metaSessionId,
  type EmbeddedSignupStep,
  type OnboardingType,
} from '@/lib/whatsapp/coexistenceEvents'

/**
 * Embedded Signup completion is two independent browser events:
 *   1. `WA_EMBEDDED_SIGNUP` postMessage (session-info) carrying waba_id
 *   2. `FB.login` callback carrying the OAuth code
 *
 * Meta does not document a guaranteed order. Reading the session ref inside
 * the login callback therefore loses a successful Meta onboarding whenever
 * the code arrives first. This gate settles only when BOTH are present.
 */

const FB_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'web.facebook.com', 'business.facebook.com'])

export type EmbeddedSignupSession = {
  waba_id?: string
  phone_number_id?: string
  onboardingType: OnboardingType
}

/**
 * Why Meta says the flow ended without finishing: either the screen the customer
 * left on, or an error Meta showed them and they reported from inside the flow.
 */
export type EmbeddedSignupCancel = {
  step?: EmbeddedSignupStep
  errorReported: boolean
  /**
   * Meta's own wording, shown to the customer. Cleaned (no control or bidi
   * formatting characters), bounded, and never stored or logged.
   */
  errorMessage?: string
  /** Meta's numeric support id for the report. Stored. */
  errorId?: string
  /**
   * Meta's opaque id for this Embedded Signup session, for a Meta support
   * ticket. Stored. Not a credential and not customer data.
   */
  sessionId?: string
}

/** What one launch of Embedded Signup resolved to. Re-exported by useEmbeddedSignup. */
export type EmbeddedSignupResult = {
  ok: boolean
  error?: string
  messagingReady?: boolean
  reason?: string
  /** Meta's own account of a cancel: the screen left, or the error shown. */
  cancel?: EmbeddedSignupCancel
}

/** A cancelled launch, carrying Meta's reason only when Meta gave one. */
export function cancelledResult(detail?: EmbeddedSignupCancel): EmbeddedSignupResult {
  return detail ? { ok: false, error: 'cancelled', cancel: detail } : { ok: false, error: 'cancelled' }
}

export type EmbeddedSignupOutcome =
  | { kind: 'ready'; code: string; session: EmbeddedSignupSession }
  | { kind: 'cancelled'; detail?: EmbeddedSignupCancel }
  | { kind: 'error'; error: string }

export type EmbeddedSignupGate = {
  acceptSession: (session: EmbeddedSignupSession) => void
  acceptCode: (code: string) => void
  /** Meta's CANCEL message. Order relative to the login callback is not guaranteed. */
  acceptCancel: (detail: EmbeddedSignupCancel) => void
  /**
   * The login callback came back without a code. Settles as cancelled — at once
   * if Meta already said why, otherwise after `graceMs` so a CANCEL message
   * arriving just behind the callback is not lost.
   */
  cancel: (graceMs?: number) => void
  /** Safety valve after the OAuth code exists but session-info never arrived. */
  expire: () => void
  outcome: Promise<EmbeddedSignupOutcome>
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

export function hasUsableWaba(session: EmbeddedSignupSession | null | undefined): boolean {
  return typeof session?.waba_id === 'string' && session.waba_id.length > 0
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

const MAX_META_ERROR_LENGTH = 300
const STEP_SET = new Set<string>(EMBEDDED_SIGNUP_STEPS)
// C0/C1 controls, and the bidi marks, embeddings, overrides and isolates that
// could reorder the surrounding Hebrew line. Plain text is all that is kept.
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g

/** Meta's error text as one bounded line of plain text; empty when nothing is left. */
function cleanMetaText(raw: string): string {
  return raw.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_META_ERROR_LENGTH)
}

/**
 * Meta's CANCEL message: `{ data: { current_step } }` when the customer left a
 * screen, `{ data: { error_message, error_code, session_id } }` when they reported
 * an error Meta showed them. Values are cleaned and bounded here because they
 * come from another window. The error code and `session_id` are kept whenever
 * well-formed, with or without a message, for a Meta support ticket.
 */
export function parseEmbeddedSignupCancel(origin: string, data: unknown): EmbeddedSignupCancel | null {
  const msg = readSignupMessage(origin, data)
  if (!msg || msg.event !== ES_EVENT_CANCEL) return null
  const d = (msg.data && typeof msg.data === 'object' ? msg.data : {}) as Record<string, unknown>

  const errorMessage = typeof d.error_message === 'string' ? cleanMetaText(d.error_message) : ''
  const cancel: EmbeddedSignupCancel = errorMessage
    ? { errorReported: true, errorMessage }
    : typeof d.current_step === 'string'
      ? { step: (STEP_SET.has(d.current_step) ? d.current_step : 'OTHER') as EmbeddedSignupStep, errorReported: false }
      : { errorReported: false }
  // Meta's docs now say `error_code`; older payloads used `error_id`.
  const errorId = metaErrorId(d.error_code) ?? metaErrorId(d.error_id)
  if (errorId) cancel.errorId = errorId
  const sessionId = metaSessionId(d.session_id)
  if (sessionId) cancel.sessionId = sessionId
  return cancel
}

export function parseEmbeddedSignupMessage(origin: string, data: unknown): EmbeddedSignupSession | null {
  const parsed = readSignupMessage(origin, data)
  if (!parsed) return null
  const msg = parsed as {
    type?: string
    event?: string
    data?: { waba_id?: string; phone_number_id?: string; messaging_account_ids?: unknown }
  }
  if (msg.type !== 'WA_EMBEDDED_SIGNUP') return null
  if (msg.event !== ES_EVENT_FINISH && msg.event !== ES_EVENT_FINISH_COEXISTENCE) return null
  // v4 sends `waba_id`; v5 sends `messaging_account_ids` ("Replaces waba_id").
  // Only an unambiguous single id is used; several would be a guess.
  const ids = msg.data?.messaging_account_ids
  const v5Waba = Array.isArray(ids) && ids.length === 1 && typeof ids[0] === 'string' ? ids[0] : undefined
  return {
    waba_id: typeof msg.data?.waba_id === 'string' ? msg.data.waba_id : v5Waba,
    phone_number_id: typeof msg.data?.phone_number_id === 'string' ? msg.data.phone_number_id : undefined,
    onboardingType: msg.event === ES_EVENT_FINISH_COEXISTENCE ? 'coexistence' : 'cloud_api',
  }
}

export function createEmbeddedSignupGate(): EmbeddedSignupGate {
  let session: EmbeddedSignupSession | null = null
  let code: string | null = null
  let cancelDetail: EmbeddedSignupCancel | null = null
  let cancelPending = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let settle!: (outcome: EmbeddedSignupOutcome) => void
  const outcome = new Promise<EmbeddedSignupOutcome>((resolve) => {
    settle = (next) => {
      if (settled) return
      settled = true
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      resolve(next)
    }
  })
  const settleCancelled = () => settle(cancelDetail ? { kind: 'cancelled', detail: cancelDetail } : { kind: 'cancelled' })

  const tryReady = () => {
    if (code && session && hasUsableWaba(session)) {
      settle({ kind: 'ready', code, session })
    }
  }

  return {
    acceptSession(next) {
      if (settled) return
      session = next
      tryReady()
    },
    acceptCode(next) {
      if (settled) return
      if (!next) {
        settle({ kind: 'cancelled' })
        return
      }
      code = next
      tryReady()
    },
    acceptCancel(detail) {
      if (settled) return
      cancelDetail = detail
      if (cancelPending) settleCancelled()
    },
    cancel(graceMs = 0) {
      if (settled) return
      if (cancelDetail || graceMs <= 0) return settleCancelled()
      cancelPending = true
      graceTimer = setTimeout(settleCancelled, graceMs)
    },
    expire() {
      if (settled) return
      // The popup is still open — login callback has not fired. Do not invent
      // a failure; cancel/code remain the authority for that path.
      if (!code) return
      settle({ kind: 'error', error: 'missing_details' })
    },
    outcome,
  }
}
