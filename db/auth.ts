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
    .select('id', 'email', 'name', 'role', 'suspended', 'tblPref', 'savedFilters', 'agencyId')
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

const secretKey = process.env.JWT_SECRET ?? 'dev-fallback-change-in-production'
const key = new TextEncoder().encode(secretKey)

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
  picture: string
  role: Roles
  suspended?: boolean
  tblPref?: any[]
  savedFilters?: { name: string; href: string }[]
  agencyId?: number
}

// return {
//   id: 3,
//   email: 'arik@pro-bit.co.il',
//   name: 'אריק עדיקה',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'ADMIN',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 144,
//   email: 'adirsegev1@gmail.com',
//   name: 'אדיר שגב',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'AGNT',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 117,
//   email: 'roeec.bitoah@gmail.com',
//   name: 'רועי כהן',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'AGNT',
//   agencyId: 1,
// } as UserDb

//  return {
//    id: 169,
//    email: 'mosh@ziv-ins.co.il',
//    name: 'משה לוי',
//    picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//    role: 'AGNT',
//    agencyId: 1,
//  } as UserDb

// return {
//   id: 47,
//   email: 'zohar@ziv-ins.co.il',
//   name: 'זוהר דדון',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'AGNT',
// agencyId: 1,
// } as UserDb

// return {
//   id: 18,
//   email: 'ron@gesherins.com	',
//   name: 'רון לוי',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'AGNT',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 28,
//   email: 'sarit@ziv-ins.co.il',
//   name: 'תומר איזון',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'AGNT',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 70,
//   email: 'sarit@ziv-ins.co.il',
//   name: 'אדי אפריימוב',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'AGNT',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 73,
//   email: 'sarit@ziv-ins.co.il',
//   name: 'אור אהוב',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'AGNT',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 159,
//   email: 'sarit@ziv-ins.co.il',
//   name: 'ריטה ביזאוי',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'OFFICE',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 54,
//   email: 'sarit@ziv-ins.co.il',
//   name: 'שי חוג׳ה',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'MNGR',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 33,
//   email: 'sarit@ziv-ins.co.il',
//   name: 'שרית ברלב',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'MNGR',
//   agencyId: 1,
// } as UserDb

// return {
//   id: 159,
//   email: 'sarit@ziv-ins.co.il',
//   name: 'מתפעל',
//   picture: 'https://avatars.githubusercontent.com/u/10198965?v=4',
//   role: 'OFFICE',
//   agencyId: 1,
// } as UserDb
