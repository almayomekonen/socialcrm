import 'server-only'
import { db } from '@/config/db'

/**
 * Rate limiting for the mobile authentication endpoints.
 *
 * ⚠️ DATABASE-BACKED, NOT IN-MEMORY, and that is the whole point. A module-level
 * `Map` counts nothing useful when the platform runs many instances — an
 * attacker simply lands on a different one. This counts rows over a sliding
 * window, the same shape as the existing support-form limiter
 * (`lib/support/rateLimit.ts`), which also counts persisted rows rather than
 * holding state in a process.
 *
 * ⚠️ THE SUBJECT IS NEVER A CREDENTIAL. Limits are keyed by normalised email or
 * by IP. A code, token or password never reaches this table.
 *
 * ⚠️ CALIBRATED TO ANNOY ATTACKERS, NOT USERS. A person signing in mistypes an
 * address once or twice and asks for one more code; the ceilings below sit well
 * above that and well below what a brute-force needs.
 */

export type ThrottleKind =
  | 'email_request'
  | 'email_verify'
  | 'register'
  | 'google'
  | 'facebook'
  | 'facebook_nonce'
  | 'refresh'
  | 'dev'
  | 'logout'

type Rule = { readonly windowMs: number; readonly max: number }

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * Per-EMAIL ceilings. These bound abuse aimed at one account — mailbox flooding,
 * and guessing one person's code.
 */
const BY_SUBJECT: Record<ThrottleKind, Rule> = {
  // Five codes an hour to one address. Enough to recover from a lost email;
  // far too few to use us as a mail cannon.
  email_request: { windowMs: HOUR, max: 5 },
  // Ten verify calls an hour per address, ON TOP of the 5-guess cap carried by
  // each individual code row. Requesting new codes cannot buy more guesses.
  email_verify: { windowMs: HOUR, max: 10 },
  register: { windowMs: HOUR, max: 3 },
  google: { windowMs: HOUR, max: 20 },
  facebook: { windowMs: HOUR, max: 20 },
  /**
   * These are keyed by IP ONLY — there is no subject to key on before the
   * credential is verified, and using the credential itself as a key would put
   * token material in this table. `facebook_nonce` is issued BEFORE any identity
   * exists at all, so it could never have a subject. The per-subject entries
   * exist so the Record is total; `isRateLimited` is always called with
   * `subject = null` for them.
   */
  facebook_nonce: { windowMs: HOUR, max: 0 },
  refresh: { windowMs: HOUR, max: 0 },
  dev: { windowMs: HOUR, max: 0 },
  logout: { windowMs: HOUR, max: 0 },
}

/**
 * Per-IP ceilings, deliberately looser: an office or a carrier NAT puts many
 * legitimate users behind one address, so this layer exists to stop a single
 * host enumerating MANY accounts, not to police one person.
 */
const BY_IP: Record<ThrottleKind, Rule> = {
  email_request: { windowMs: HOUR, max: 30 },
  email_verify: { windowMs: HOUR, max: 60 },
  register: { windowMs: HOUR, max: 10 },
  google: { windowMs: HOUR, max: 60 },
  facebook: { windowMs: HOUR, max: 60 },
  /**
   * INTENTIONALLY ABOVE `facebook` (60). One sign-in spends one nonce and then
   * one verification, so a ceiling at or below `facebook` would make nonce
   * issuance — not verification — the binding constraint, and a user behind a NAT
   * would be blocked a step earlier with a less meaningful error. The real
   * control belongs on the endpoint that checks a credential; this one only mints
   * a short-lived, single-use, unguessable value, so it just bounds table growth.
   */
  facebook_nonce: { windowMs: HOUR, max: 120 },
  /**
   * DELIBERATELY GENEROUS. An access token lives 15 minutes, so one active device
   * refreshes ~4×/hour; an office or carrier NAT can put dozens behind one
   * address. Too tight here would sign legitimate users OUT — the failure mode is
   * worse than the abuse it prevents, because refresh tokens are 32 bytes of
   * CSPRNG and cannot be guessed. This bounds resource exhaustion, nothing else.
   */
  refresh: { windowMs: HOUR, max: 200 },
  dev: { windowMs: HOUR, max: 30 },
  // Idempotent and always 204; this only stops a flood.
  logout: { windowMs: HOUR, max: 120 },
}

/** Guesses allowed against a single issued code before it is burned. */
export const MAX_CODE_ATTEMPTS = 5

async function countSince(kind: ThrottleKind, subject: string, windowMs: number): Promise<number> {
  const row = await db('mobile_auth_attempts')
    .where({ kind, subject })
    .where('created_at', '>', new Date(Date.now() - windowMs))
    .count({ n: '*' })
    .first()
  return Number(row?.n ?? 0)
}

/** Records one attempt. Best-effort: a logging failure must not deny sign-in. */
export async function recordAttempt(kind: ThrottleKind, subject: string): Promise<void> {
  try {
    await db('mobile_auth_attempts').insert({ kind, subject })
  } catch (err) {
    console.error('[mobile/rateLimit] could not record attempt', {
      kind,
      reason: (err as Error)?.message,
    })
  }
}

/**
 * True when the caller is over either ceiling.
 *
 * ⚠️ FAILS OPEN, on purpose. If the throttle table is unreachable the choice is
 * between locking every user out of the product and losing rate limiting during
 * an outage. The endpoints behind this still verify credentials properly, so an
 * open failure degrades a defence-in-depth layer rather than the authentication
 * boundary itself. The alternative — a database blip becoming a total sign-in
 * outage — is the worse failure.
 */
export async function isRateLimited(
  kind: ThrottleKind,
  subject: string | null,
  ip: string,
): Promise<boolean> {
  try {
    if (subject) {
      const rule = BY_SUBJECT[kind]
      if ((await countSince(kind, subject, rule.windowMs)) >= rule.max) {
        console.warn('[mobile/rateLimit] subject limit reached', { kind })
        return true
      }
    }

    const ipRule = BY_IP[kind]
    if ((await countSince(kind, `ip:${ip}`, ipRule.windowMs)) >= ipRule.max) {
      console.warn('[mobile/rateLimit] ip limit reached', { kind })
      return true
    }

    return false
  } catch (err) {
    console.error('[mobile/rateLimit] check failed — allowing request', {
      kind,
      reason: (err as Error)?.message,
    })
    return false
  }
}

/** Records the attempt against both the subject and the IP. */
export async function recordAttempts(
  kind: ThrottleKind,
  subject: string | null,
  ip: string,
): Promise<void> {
  if (subject) await recordAttempt(kind, subject)
  await recordAttempt(kind, `ip:${ip}`)
}
