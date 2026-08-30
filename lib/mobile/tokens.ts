import 'server-only'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { jwtVerify, SignJWT } from 'jose'
import { db } from '@/config/db'

/**
 * Token primitives for the native mobile client.
 *
 * DELIBERATELY SEPARATE FROM `db/auth.ts`. The web session helpers are not
 * reused here, and that is the point rather than duplication for its own sake:
 *
 *  1. `getUser()` reads `cookies()` and nothing else — there is no header path
 *     in the web session layer to extend.
 *  2. The web `JWT_SECRET` also signs `encrypt()` output (fb_pages, WhatsApp
 *     phone numbers, the deal-export link) with a 365-day lifetime. Signing a
 *     phone-held credential with that same key would let any one of those token
 *     classes be replayed as another. A separate key makes the classes
 *     structurally non-interchangeable.
 *  3. The cookie verifier accepts a token with NO `typ` and NO `sv` claim
 *     (`payload.typ !== undefined && ...`) so that sessions issued before those
 *     claims existed keep working. That backwards-compatibility grace must not
 *     follow us onto mobile, where there is no legacy token to protect. Here
 *     both claims are MANDATORY — absent means invalid.
 */

const ACCESS_TOKEN_TYPE = 'mobile_access'

/** Short, because revocation is only as fast as the access token's lifetime. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

/** Matches the web session window so a phone is not trusted longer than a desktop. */
export const REFRESH_TOKEN_TTL_DAYS = 30

export type RevokedReason =
  | 'rotated'
  | 'logout'
  | 'reuse_detected'
  | 'user_revoked'

function mobileKey(): Uint8Array {
  const secret = process.env.MOBILE_JWT_SECRET
  // FAIL CLOSED. Falling back to JWT_SECRET would silently recreate the shared-key
  // problem this module exists to avoid, and a generated-per-boot default would
  // invalidate every live session on restart while looking like it worked.
  if (!secret || secret.length < 32) {
    throw new Error('MOBILE_JWT_SECRET is missing or too short (needs >= 32 chars)')
  }
  return new TextEncoder().encode(secret)
}

/**
 * Mints the short-lived bearer credential.
 *
 * `sv` is read at mint time and re-compared on every verify, which is what makes
 * "sign out everywhere" take effect within one access-token lifetime.
 */
export async function signMobileAccessToken(userId: number): Promise<string> {
  const row = await db('users').where({ id: userId }).first('sessionVersion')
  const sv = Number(row?.sessionVersion ?? 0)

  return await new SignJWT({ id: userId, sv, typ: ACCESS_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(mobileKey())
}

export type MobileAccessClaims = { userId: number; sessionVersion: number }

/**
 * Verifies a bearer credential's SHAPE and SIGNATURE only.
 *
 * Returns claims, never a user: whether that user still exists, is suspended, or
 * still has an agency are database facts that a signed token cannot attest to.
 * `requireMobileUser` performs those checks — this function must not be used as
 * an authorization boundary on its own.
 */
export async function verifyMobileAccessToken(token: string): Promise<MobileAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, mobileKey(), { algorithms: ['HS256'] })

    // MANDATORY, unlike the cookie path. A token that does not say what it is,
    // is not trusted to be anything.
    if (payload.typ !== ACCESS_TOKEN_TYPE) return null

    const userId = Number(payload.id)
    if (!Number.isInteger(userId) || userId <= 0) return null

    // MANDATORY. `undefined` here would mean "skip revocation", which is exactly
    // the hole the web verifier still carries for legacy cookies.
    if (payload.sv === undefined) return null
    const sessionVersion = Number(payload.sv)
    if (!Number.isFinite(sessionVersion)) return null

    return { userId, sessionVersion }
  } catch {
    // Expired, wrong key, tampered, malformed — all indistinguishable to a
    // caller, and all mean the same thing: not authenticated.
    return null
  }
}

/* ────────────────────────────── refresh credentials ───────────────────────── */

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export type IssuedRefreshToken = { token: string; familyId: string; expiresAt: Date }

export type DeviceInfo = {
  deviceId?: string | null
  deviceName?: string | null
  platform?: string | null
  userAgent?: string | null
  ip?: string | null
}

/**
 * Issues an opaque refresh credential and records only its hash.
 *
 * `familyId` is carried across rotations so that reuse of any generation can
 * revoke every descendant of the original sign-in.
 */
export async function issueRefreshToken(
  userId: number,
  device: DeviceInfo = {},
  familyId: string = randomUUID(),
): Promise<IssuedRefreshToken> {
  // 32 bytes of CSPRNG output. Not a JWT: nothing about it should be readable.
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db('mobile_refresh_tokens').insert({
    user_id: userId,
    family_id: familyId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
    device_id: device.deviceId ?? null,
    device_name: device.deviceName ?? null,
    platform: device.platform ?? null,
    user_agent: device.userAgent ?? null,
    ip: device.ip ?? null,
  })

  return { token, familyId, expiresAt }
}

export type RefreshOutcome =
  | { ok: true; userId: number; familyId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' }

/**
 * Consumes a refresh credential exactly once.
 *
 * The single most important branch is `used_at != null`: that token was already
 * exchanged, so the copy presented now is either a replay or a clone from a
 * compromised device. Revoking only the presented token would leave the
 * attacker's newer token alive, so the whole family dies.
 */
export async function consumeRefreshToken(raw: string): Promise<RefreshOutcome> {
  const tokenHash = hashToken(raw)

  return await db.transaction(async (trx) => {
    // Locked so two concurrent refreshes cannot both observe an unused row and
    // both succeed — which would hand out two live lineages from one credential.
    const row = await trx('mobile_refresh_tokens')
      .where({ token_hash: tokenHash })
      .forUpdate()
      .first()

    if (!row) return { ok: false as const, reason: 'unknown' as const }

    if (row.used_at) {
      await trx('mobile_refresh_tokens')
        .where({ family_id: row.family_id })
        .whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now(), revoked_reason: 'reuse_detected' })
      return { ok: false as const, reason: 'reused' as const }
    }

    if (row.revoked_at) return { ok: false as const, reason: 'revoked' as const }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return { ok: false as const, reason: 'expired' as const }
    }

    await trx('mobile_refresh_tokens')
      .where({ id: row.id })
      .update({ used_at: trx.fn.now(), revoked_at: trx.fn.now(), revoked_reason: 'rotated' })

    return { ok: true as const, userId: Number(row.user_id), familyId: String(row.family_id) }
  })
}

/** Ends one device's session. Other devices keep working — that is the point. */
export async function revokeRefreshFamily(familyId: string, reason: RevokedReason): Promise<void> {
  await db('mobile_refresh_tokens')
    .where({ family_id: familyId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(), revoked_reason: reason })
}

/** Ends every mobile session for a user without touching their web cookie. */
export async function revokeAllRefreshTokens(userId: number, reason: RevokedReason): Promise<void> {
  await db('mobile_refresh_tokens')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(), revoked_reason: reason })
}

/**
 * Constant-time compare for any secret sent as a header (e.g. the development
 * sign-in secret). `===` on secrets leaks length and prefix through timing.
 */
export function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
