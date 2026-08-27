// Imported from the PURE events module, never from `coexistence.ts`: this file
// is reachable from `useEmbeddedSignup` ('use client'), and importing the
// server-only module here pulls db/auth.ts and knex into the browser bundle.
import {
  ES_EVENT_FINISH,
  ES_EVENT_FINISH_COEXISTENCE,
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

const FB_HOSTS = new Set(['www.facebook.com', 'web.facebook.com', 'business.facebook.com'])

export type EmbeddedSignupSession = {
  waba_id?: string
  phone_number_id?: string
  onboardingType: OnboardingType
}

export type EmbeddedSignupOutcome =
  | { kind: 'ready'; code: string; session: EmbeddedSignupSession }
  | { kind: 'cancelled' }
  | { kind: 'error'; error: string }

export type EmbeddedSignupGate = {
  acceptSession: (session: EmbeddedSignupSession) => void
  acceptCode: (code: string) => void
  cancel: () => void
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

export function parseEmbeddedSignupMessage(origin: string, data: unknown): EmbeddedSignupSession | null {
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
  const msg = parsed as {
    type?: string
    event?: string
    data?: { waba_id?: string; phone_number_id?: string }
  }
  if (msg.type !== 'WA_EMBEDDED_SIGNUP') return null
  if (msg.event !== ES_EVENT_FINISH && msg.event !== ES_EVENT_FINISH_COEXISTENCE) return null
  return {
    waba_id: typeof msg.data?.waba_id === 'string' ? msg.data.waba_id : undefined,
    phone_number_id: typeof msg.data?.phone_number_id === 'string' ? msg.data.phone_number_id : undefined,
    onboardingType: msg.event === ES_EVENT_FINISH_COEXISTENCE ? 'coexistence' : 'cloud_api',
  }
}

export function createEmbeddedSignupGate(): EmbeddedSignupGate {
  let session: EmbeddedSignupSession | null = null
  let code: string | null = null
  let settled = false
  let settle!: (outcome: EmbeddedSignupOutcome) => void
  const outcome = new Promise<EmbeddedSignupOutcome>((resolve) => {
    settle = (next) => {
      if (settled) return
      settled = true
      resolve(next)
    }
  })

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
    cancel() {
      settle({ kind: 'cancelled' })
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
