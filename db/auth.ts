import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { jwtVerify, SignJWT } from 'jose'
import { cookies } from 'next/headers'
import { daysFromNow } from '@/lib/dates'
import { cacheTag } from 'next/cache'

async function getCachedUser(userId: number) {
  'use cache'

  cacheTag('user' + userId, 'users')

  if (!userId) return null
  return await db('users')
    .select('id', 'email', 'name', 'gglName', 'picture', 'role', 'suspended', 'tblPref', 'savedFilters', 'agencyId')
    .where({ id: userId })
    .first()
}

export async function getUser() {
  const cokis = await cookies()

  const session = cokis.get('user')?.value
  if (!session) return null

  let decryptUser: any
  try {
    decryptUser = await decrypt(session)
  } catch {
    // Cookie signed with old key or otherwise invalid — return null to trigger re-login
    return null
  }

  const userId = decryptUser?.id
  if (!userId) {
    cokis.delete('user')
    return null
  }

  return (await getCachedUser(userId)) as UserDb | null
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
