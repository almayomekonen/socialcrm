'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidateTag } from 'next/cache'
import { db } from '@/config/db'
import { NextRequest, NextResponse } from 'next/server'
import { Roles } from '@/types/roles'
import { createCookie, decrypt, encrypt, getUserByEmail } from '../db/auth'
import { daysFromNow } from '@/lib/dates'
import { genToken } from '@/lib/funcs'
import { baseUrl } from '@/types/vars'
import { sendEmail } from '@/lib/email/sender'
import { renderEmail } from '@/lib/email/render'
import MagicLinkEmail from '@/emails/templates/MagicLinkEmail'
import { normalizeEmail } from '@/lib/normalizeEmail'

const MAGIC_LINK_EXPIRY_MINUTES = 15

export async function checkUserSuspended(user) {
  const cokis = await cookies()

  if (user?.suspended) {
    console.log(
      JSON.stringify({
        tag: 'AUTH_REDIRECT',
        route: 'checkUserSuspended',
        reason: 'user_suspended',
        userId: user?.id ?? null,
        email: user?.email ?? null,
        ts: new Date().toISOString(),
      }),
    )
    cokis.delete('user')
    redirect('/auth')
  }
}

export async function checkUser(user) {
  const start = Date.now()
  const email = normalizeEmail(user.email)
  const userExist = (await isUserExists(email)) as any
  if (userExist.fail) {
    console.log(`[AUTH] route=google_check email=${email} ms=${Date.now() - start} result=fail reason=${userExist.msg}`)
    return { fail: true, msg: userExist.msg }
  }

  await db('users').where({ id: userExist.id }).update({ gglName: user.gglName, picture: user.picture, gglSub: user.gglSub })
  revalidateTag('user' + userExist.id, 'default')

  await createCookie(userExist.id)
  console.log(`[AUTH] route=google_check email=${email} ms=${Date.now() - start} result=success`)
  console.log(
    JSON.stringify({
      tag: 'DASHBOARD_REDIRECT',
      route: 'checkUser',
      reason: 'login_success',
      userId: userExist.id,
      email,
      ts: new Date().toISOString(),
    }),
  )
  redirect('/dashboard')
}

export async function isUserExists(email: string) {
  const userExist = await getUserByEmail(email)

  if (!userExist) return { fail: true, msg: 'המשתמש לא קיים' }
  if (userExist.suspended) return { fail: true, msg: 'המשתמש מושהה' }
  return userExist
}

export async function deleteUserCookie() {
  const cokis = await cookies()
  cokis.delete('user')
}

export async function logout() {
  const cokis = await cookies()
  cokis.delete('user')
  redirect('/')
}

export async function updateSession(request: NextRequest) {
  const user = request.cookies.get('user')?.value
  if (!user) return

  // Refresh the user session so it doesn't expire
  const parsed = await decrypt(user)
  parsed.expires = daysFromNow(2)
  const res = NextResponse.next()
  res.cookies.set({
    name: 'user',
    value: await encrypt(parsed),
    httpOnly: true,
    expires: parsed.expires,
  })
  return res
}

export async function checkCookie() {
  const cokis = await cookies()
  const user = cokis.get('user')?.value
  if (!user) return null
  const parsed = await decrypt(user)
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

export async function sendToken(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const start = Date.now()
  email = normalizeEmail(email)
  const token = genToken()
  const tokenExpiry = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000)
  await db('users').where('email', email).update({ otp: { token, tokenExpiry } })

  const magicLink = `${baseUrl}/api/magic?token=${token}&email=${encodeURIComponent(email)}`

  const html = await renderEmail(
    MagicLinkEmail({ magicUrl: magicLink, expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES }),
  )

  const result = await sendEmail({
    to: email,
    subject: 'התחברות ל-SocialCRM',
    html,
  })

  if (!result.ok) {
    await db('users').where('email', email).update({ otp: null })
    console.warn(`[AUTH] route=magic_send email=${email} ms=${Date.now() - start} result=fail reason=email_send_failed`)
    return { ok: false, error: 'שליחת קישור ההתחברות נכשלה. נסה שוב בעוד רגע.' }
  }

  console.log(`[AUTH] route=magic_send email=${email} ms=${Date.now() - start} result=success`)
  return { ok: true }
}
