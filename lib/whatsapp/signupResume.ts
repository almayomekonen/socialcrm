import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import type { OnboardingType } from '@/lib/whatsapp/coexistenceEvents'

/**
 * Keeps a finished Meta authorization when SocialCRM's own next step fails.
 *
 * Meta's OAuth code works once. If a provider or database failure hits after the
 * exchange, nothing else holds the token, and the customer has to repeat Meta's
 * whole flow. A connection row cannot hold it: a row means "subscribed", which is
 * the false-connected state the Oren 2026-07-21 incident was about.
 *
 * So it stays where `fb_pages` and `wa_phones` already keep pending credentials:
 * a short-lived, httpOnly, AES-256-GCM cookie bound to the user and agency. The
 * browser cannot read it. It is deleted as soon as the signup finishes or fails
 * for good.
 */
export const SIGNUP_RESUME_COOKIE = 'wa_signup_resume'
export const SIGNUP_RESUME_MAX_AGE_S = 60 * 60 * 24

const ENVELOPE_PREFIX = 'wsr1.'

export type SignupResumeState = {
  accessToken: string
  wabaId?: string
  wabaCandidates?: string[]
  phoneNumberId?: string
  browserOnboardingType: OnboardingType
  attemptId?: string
  /** A save may have committed before the sync ran: run it even if a row exists. */
  syncPending?: boolean
  /** Fixed when first kept. A failed resume keeps this, so retrying never extends the token's life. */
  expiresAt?: number
}

type Envelope = SignupResumeState & { agencyId: number; userId: number; exp: number }

/** Null when it cannot be sealed: the caller reports the signup as not resumable. */
export function sealSignupResume(state: SignupResumeState, owner: { agencyId: number; userId: number }, now: number = Date.now()): string | null {
  try {
    const envelope: Envelope = { ...state, ...owner, exp: state.expiresAt ?? now + SIGNUP_RESUME_MAX_AGE_S * 1000 }
    return ENVELOPE_PREFIX + encryptSecret(JSON.stringify(envelope))
  } catch {
    return null
  }
}

/** Null for a missing, expired, tampered or foreign cookie. Never throws. */
export function readSignupResume(
  cookieValue: string | undefined,
  owner: { agencyId: number; userId: number },
  now: number = Date.now(),
): SignupResumeState | null {
  if (!cookieValue?.startsWith(ENVELOPE_PREFIX)) return null
  try {
    const env = JSON.parse(decryptSecret(cookieValue.slice(ENVELOPE_PREFIX.length))) as Partial<Envelope>
    if (env.agencyId !== owner.agencyId || env.userId !== owner.userId) return null
    if (typeof env.exp !== 'number' || env.exp <= now || typeof env.accessToken !== 'string' || !env.accessToken) return null
    return {
      accessToken: env.accessToken,
      wabaId: env.wabaId,
      wabaCandidates: env.wabaCandidates,
      phoneNumberId: env.phoneNumberId,
      browserOnboardingType: env.browserOnboardingType === 'coexistence' ? 'coexistence' : 'cloud_api',
      attemptId: env.attemptId,
      syncPending: env.syncPending === true,
      expiresAt: env.exp,
    }
  } catch {
    return null
  }
}

/** The cookie's attributes: same as `wa_phones`, living only as long as what it holds. */
export function signupResumeCookieOptions(state: SignupResumeState, now: number = Date.now()) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: state.expiresAt ? Math.max(1, Math.ceil((state.expiresAt - now) / 1000)) : SIGNUP_RESUME_MAX_AGE_S,
    path: '/',
  }
}
