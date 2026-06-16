import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { jwtVerify, SignJWT } from 'jose'
import { cookies, headers } from 'next/headers'
import { daysFromNow } from '@/lib/dates'
import { cacheTag } from 'next/cache'
import { recordLoginActivity } from './loginActivity'

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
  if (!session) {
    console.log(JSON.stringify({ tag: 'GETUSER', reason: 'no_cookie', ts: new Date().toISOString() }))
    return null
  }

  let payload: any
  try {
    payload = await decrypt(session)
  } catch (err) {
    console.warn('[auth] cookie verify failed', { reason: (err as Error)?.message })
    console.log(
      JSON.stringify({ tag: 'GETUSER', reason: 'decrypt_failed', error: (err as Error)?.message, ts: new Date().toISOString() }),
    )
    return null
  }

  const userId = payload?.id
  if (!userId) {
    console.log(
      JSON.stringify({ tag: 'GETUSER', reason: 'missing_payload_id', cookiePayload: payload, ts: new Date().toISOString() }),
    )
    cokis.delete('user')
    return null
  }

  try {
    const row = await fetchUserById(userId)
    if (!row) {
      console.log(
        JSON.stringify({
          tag: 'GETUSER',
          reason: 'db_user_not_found',
          cookieUserId: userId,
          cookieExpires: payload?.expires,
          ts: new Date().toISOString(),
        }),
      )
      return null
    }
    return row
  } catch (err) {
    console.error('[auth] user fetch failed', { userId, reason: (err as Error)?.message })
    console.log(
      JSON.stringify({
        tag: 'GETUSER',
        reason: 'db_exception',
        cookieUserId: userId,
        error: (err as Error)?.message,
        ts: new Date().toISOString(),
      }),
    )
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

export async function createCookie(userId) {
  const cokis = await cookies()
  const expires = daysFromNow(365)
  const userToken = await encrypt({ id: userId, expires })
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
  return await db('users').select('id', 'suspended', 'otp').whereILike('email', email).first()
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
}
