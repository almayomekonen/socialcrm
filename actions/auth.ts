'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidateTag } from 'next/cache'
import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { createCookie, getUser, getUserByEmail } from '../db/auth'
import { genToken } from '@/lib/funcs'
import { baseUrl } from '@/types/vars'
import { sendEmail } from '@/lib/email/sender'
import { renderEmail } from '@/lib/email/render'
import MagicLinkEmail from '@/emails/templates/MagicLinkEmail'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const MAGIC_LINK_EXPIRY_MINUTES = 15

// Google Sign-In (GIS) verification. The browser receives a signed ID token
// (the `credential`) from Google; the server MUST verify that signature against
// Google's public keys before trusting any identity claim inside it. Anything
// less lets a caller assert an arbitrary `email` and be logged in as that user.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

type VerifiedGoogleUser = { email: string; name?: string; picture?: string; sub: string }

async function verifyGoogleCredential(credential: unknown): Promise<VerifiedGoogleUser | null> {
  if (typeof credential !== 'string' || !credential) return null
  const audience = process.env.NEXT_PUBLIC_GGLID
  if (!audience) {
    console.error('[AUTH] NEXT_PUBLIC_GGLID is not set — cannot verify Google credential')
    return null
  }
  try {
    const { payload } = await jwtVerify(credential, googleJwks, {
      issuer: GOOGLE_ISSUERS,
      audience,
    })
    // Google ID tokens normally carry email_verified as a boolean; some token
    // variants send the string "true". Accept both so legitimate logins are not
    // rejected — the signature check above is what actually gates trust.
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
    if (!emailVerified || typeof payload.email !== 'string' || !payload.sub) return null
    return {
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
      sub: String(payload.sub),
    }
  } catch (err) {
    console.warn('[AUTH] google credential verification failed', { reason: (err as Error)?.message })
    return null
  }
}

export async function checkUser(input: { credential?: string }) {
  const start = Date.now()

  // Identity is derived ONLY from the server-verified Google ID token. The
  // client no longer supplies email/name/sub — those are read from the verified
  // token below, so a forged payload cannot authenticate as another user.
  const verified = await verifyGoogleCredential(input?.credential)
  if (!verified) {
    console.warn(`[AUTH] route=google_check ms=${Date.now() - start} result=fail reason=invalid_credential`)
    return { fail: true, msg: 'ההתחברות נכשלה, נסה שוב' }
  }

  const email = normalizeEmail(verified.email)
  const userExist = (await isUserExists(email)) as any
  if (userExist.fail) {
    console.log(`[AUTH] route=google_check email=${email} ms=${Date.now() - start} result=fail reason=${userExist.msg}`)
    // Return the verified email/name so the client can prefill registration.
    return { fail: true, msg: userExist.msg, email, name: verified.name ?? '' }
  }

  await db('users')
    .where({ id: userExist.id })
    .update({ gglName: verified.name, picture: verified.picture, gglSub: verified.sub })
  revalidateTag('user' + userExist.id, 'default')

  await createCookie(userExist.id)
  console.log(`[AUTH] route=google_check email=${email} ms=${Date.now() - start} result=success`)
  redirect('/dashboard')
}

export async function isUserExists(email: string) {
  const userExist = await getUserByEmail(email)

  if (!userExist) return { fail: true, msg: 'המשתמש לא קיים' }
  if (userExist.suspended) return { fail: true, msg: 'המשתמש מושהה' }
  // Return ONLY a non-sensitive existence marker. getUserByEmail selects the
  // `otp` column — a live magic-link token — and returning the raw row exposed
  // it to callers, a pre-auth account-takeover primitive. Callers only need id.
  return { id: userExist.id }
}

export async function getSessionState(): Promise<boolean> {
  return !!(await getUser())
}

export async function logout() {
  const cokis = await cookies()
  cokis.delete('user')
  redirect('/')
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

  // Only issue a magic link to a real, active account. Sending to whatever
  // address the caller supplies turned this into an open email relay (spam from
  // our domain to arbitrary recipients). The response is uniform so this gate
  // does not itself leak account existence.
  const user = await getUserByEmail(email)
  if (!user || user.suspended) {
    console.log(`[AUTH] route=magic_send email=${email} ms=${Date.now() - start} result=noop`)
    return { ok: true }
  }

  const token = genToken()
  const tokenExpiry = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000)
  await db('users').where({ id: user.id }).update({ otp: { token, tokenExpiry } })

  const magicLink = `${baseUrl}/api/magic?token=${token}&email=${encodeURIComponent(email)}`

  const html = await renderEmail(MagicLinkEmail({ magicUrl: magicLink, expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES }))

  const result = await sendEmail({
    to: email,
    subject: 'התחברות ל-SocialCRM',
    html,
  })

  if (!result.ok) {
    await db('users').where({ id: user.id }).update({ otp: null })
    console.warn(`[AUTH] route=magic_send email=${email} ms=${Date.now() - start} result=fail reason=email_send_failed`)
    return { ok: false, error: 'שליחת קישור ההתחברות נכשלה. נסה שוב בעוד רגע.' }
  }

  console.log(`[AUTH] route=magic_send email=${email} ms=${Date.now() - start} result=success`)
  return { ok: true }
}
