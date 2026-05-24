import { NextRequest } from 'next/server'
import { db } from '@/config/db'
import { createCookie, getUserByEmail } from '@/db/auth'

export async function GET(request: NextRequest) {
  const start = Date.now()
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  if (!email || !token) return failed(start, email, 'missing_params')

  const user = await getUserByEmail(email)

  if (!user) return failed(start, email, 'no_user')
  if (user.suspended) return failed(start, email, 'suspended')
  if (user.otp?.token !== token) return failed(start, email, 'bad_token')

  const expiryMs = user.otp?.tokenExpiry ? new Date(user.otp.tokenExpiry).getTime() : 0
  if (!expiryMs || expiryMs < Date.now()) return failed(start, email, 'expired')

  await db('users').where({ id: user.id }).update({ otp: null })

  await createCookie(user.id)

  console.log(`[AUTH] route=magic_verify email=${email} ms=${Date.now() - start} result=success`)
  return new Response(null, {
    status: 302,
    headers: { Location: '/dashboard' },
  })
}

const failed = (start: number, email: string | null, reason: string) => {
  console.warn(`[AUTH] route=magic_verify email=${email ?? ''} ms=${Date.now() - start} result=fail reason=${reason}`)
  return new Response(null, {
    status: 302,
    headers: { Location: '/auth?error=failed' },
  })
}
