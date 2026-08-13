import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { jwtVerify, SignJWT } from 'jose'
import { cookies, headers } from 'next/headers'
import { daysFromNow } from '@/lib/dates'
import { cacheTag } from 'next/cache'
import { recordLoginActivity } from './loginActivity'

/**
 * Session tokens are stateless JWTs, so revocation needs a server-side counter
 * to compare against: `users.sessionVersion`. A token records the version it was
 * minted with (`sv`); bumping the column invalidates every token issued before
 * the bump, i.e. signs the user out of all devices.
 *
 * `typ` discriminates session cookies from the other tokens signed with the same
 * key (fb_pages, whatsapp phones, the deal-export token), so one can never be
 * replayed as the other.
 */
const SESSION_TTL_DAYS = 30
const SESSION_TOKEN_TYPE = 'session'

const USER_COLUMNS = [
  'id',
  'email',
  'name',
  'gglName',
  'picture',
  'role',
  'suspended',
  'tblPref',
  'savedFilters',
  'agencyId',
  'sessionVersion',
] as const

async function fetchUserById(userId: number): Promise<UserDb | null> {
  if (!userId) return null
  const row = await db('users')
    .select(...USER_COLUMNS)
    .where({ id: userId })
    .first()
  return (row ?? null) as UserDb | null
}

export async function getCachedUser(userId: number): Promise<UserDb | null> {
  'use cache'
  cacheTag('user' + userId, 'users')
  return fetchUserById(userId)
}

export async function getUser(): Promise<UserDb | null> {
  const cokis = await cookies()

  const session = cokis.get('user')?.value
  if (!session) return null

  let payload: any
  try {
    payload = await decrypt(session)
  } catch (err) {
    console.warn('[auth] cookie verify failed', { reason: (err as Error)?.message })
    return null
  }

  // A token that declares a type must be a session token. Tokens minted before
  // this change carry no `typ` and are still accepted (grace-mode rollout).
  if (payload?.typ !== undefined && payload.typ !== SESSION_TOKEN_TYPE) {
    console.warn('[auth] rejected non-session token presented as a session')
    return null
  }

  const userId = payload?.id
  if (!userId) {
    cokis.delete('user')
    return null
  }

  try {
    // A stale cookie — an id with no matching DB row (deleted/recreated
    // account) — returns null here. The invalid cookie is NOT cleared in this
    // Server Component (cookie mutation is disallowed); the (app) layout routes
    // such sessions to the /api/auth/clear Route Handler, which can.
    const user = await fetchUserById(userId)
    if (!user) return null

    // Revocation check. Grace-mode: only enforced for tokens that carry `sv`,
    // so sessions issued before this change keep working until they expire.
    if (payload.sv !== undefined && Number(payload.sv) !== Number(user.sessionVersion ?? 0)) {
      console.warn('[auth] session revoked by sessionVersion mismatch', { userId })
      return null
    }

    return user
  } catch (err) {
    console.error('[auth] user fetch failed', { userId, reason: (err as Error)?.message })
    return null
  }
}

if (!process.env.JWT_SECRET) {
  throw new Error('[auth] JWT_SECRET is not set')
}
const key = new TextEncoder().encode(process.env.JWT_SECRET)

export async function decrypt(input: string): Promise<any> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ['HS256'],
  })
  return payload
}

/**
 * Signs the user out of every device by invalidating all tokens minted before
 * this call. Stateless sessions cannot be deleted server-side, so revocation is
 * expressed as a version bump that existing tokens can no longer match.
 */
export async function revokeUserSessions(userId: number): Promise<void> {
  await db('users').where({ id: userId }).increment('sessionVersion', 1)
}

export async function createCookie(userId) {
  const cokis = await cookies()
  const expires = daysFromNow(SESSION_TTL_DAYS)

  // Bind the token to the user's current session version so it can be revoked,
  // and tag it as a session token. Signed here rather than via `encrypt()`
  // because that helper is shared with fb_pages / whatsapp / the deal-export
  // token, which must keep their own lifetimes.
  const row = await db('users').where({ id: userId }).first('sessionVersion')
  const sv = Number(row?.sessionVersion ?? 0)
  const userToken = await new SignJWT({ id: userId, sv, typ: SESSION_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(key)

  cokis.set('user', userToken, { expires, httpOnly: true, secure: true, sameSite: 'lax' })

  // Login-activity capture must never break login: any failure is swallowed.
  try {
    const h = await headers()
    const xff = h.get('x-forwarded-for') ?? ''
    const ip = xff.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
    const userAgent = h.get('user-agent') ?? ''
    await recordLoginActivity(userId, { ip, userAgent })
  } catch (err) {
    console.warn('[login-activity] capture failed', { userId, reason: (err as Error)?.message })
  }
}

export async function getUserByEmail(email: string) {
  return await db('users')
    .select('id', 'suspended', 'otp', 'emailVerifiedAt', 'facebookSub', 'agencyId')
    .whereILike('email', email)
    .first()
}

export async function getUserByFacebookSub(facebookSub: string) {
  if (!facebookSub) return null
  return await db('users').select('id', 'suspended', 'facebookSub', 'agencyId').where({ facebookSub }).first()
}

export async function encrypt(payload: any) {
  return await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('365 days').sign(key)
}

export type UserDb = {
  id: number
  email: string
  name: string
  gglName?: string | null
  picture: string
  role: Roles
  suspended?: boolean
  tblPref?: any[]
  savedFilters?: { name: string; href: string }[]
  agencyId?: number
  /** Server-side revocation counter; compared against the token's `sv` claim. */
  sessionVersion?: number
}
