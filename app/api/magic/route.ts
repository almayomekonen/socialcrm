import { NextRequest } from 'next/server'
import { db } from '@/config/db'
import { createCookie, getUserByEmail, revokeUserSessions } from '@/db/auth'
import { postLoginDestinationFromCookie } from '@/lib/oauth/server/postLoginDestination'
import { PENDING_COOKIE } from '@/lib/oauth/server/pendingRequest'

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

  // First proof that this address is really the holder's: registration issues an
  // account (and a session) for an unverified email, so anyone could have
  // created this account and still hold a session on it. Evict every session
  // minted before this moment, then mark the address verified.
  if (!user.emailVerifiedAt) {
    await revokeUserSessions(user.id)
    console.warn('[AUTH] first email verification — prior sessions revoked', { userId: user.id })
  }

  await db('users')
    .where({ id: user.id })
    .update({ otp: null, emailVerifiedAt: user.emailVerifiedAt ?? new Date() })

  await createCookie(user.id)

  console.log(`[AUTH] route=magic_verify email=${email} ms=${Date.now() - start} result=success`)
  // '/dashboard', or '/oauth/consent' when a validated ChatGPT authorization is pending.
  const location = await postLoginDestinationFromCookie(request.cookies.get(PENDING_COOKIE)?.value)
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  })
}

const failed = (start: number, email: string | null, reason: string) => {
  console.warn(`[AUTH] route=magic_verify email=${email ?? ''} ms=${Date.now() - start} result=fail reason=${reason}`)
  return new Response(null, {
    status: 302,
    headers: { Location: '/auth?error=failed' },
  })
}
