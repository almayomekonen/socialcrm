'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidateTag } from 'next/cache'
import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { createCookie, getUser, getUserByEmail, getUserByFacebookSub, revokeUserSessions } from '../db/auth'
import { genToken } from '@/lib/funcs'
import { resolveBaseUrl } from '@/types/vars'
import { sendEmail } from '@/lib/email/sender'
import { renderEmail } from '@/lib/email/render'
import MagicLinkEmail from '@/emails/templates/MagicLinkEmail'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { verifyFacebookAccessToken } from '@/lib/auth/verifyFacebookAccessToken'
import { clearFacebookLoginProof, setFacebookLoginProof } from '@/lib/auth/fbLoginProof'
import { resolveFacebookLogin } from '@/lib/auth/resolveFacebookLogin'
import { postLoginDestination } from '@/lib/oauth/server/postLoginDestination'
import {
  canUseFacebookUserAuth,
  isFacebookUserAuthOpenToNewAgencies,
} from '@/lib/auth/facebookUserAuthFlags'

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

  // First proof of ownership for this address (see /api/magic): registration
  // creates accounts for unverified emails, so evict any session issued before
  // the real owner proved the address, then mark it verified.
  const existing = await db('users').where({ id: userExist.id }).first('emailVerifiedAt')
  if (!existing?.emailVerifiedAt) {
    await revokeUserSessions(userExist.id)
    console.warn('[AUTH] first email verification — prior sessions revoked', { userId: userExist.id })
  }

  await db('users')
    .where({ id: userExist.id })
    .update({
      gglName: verified.name,
      picture: verified.picture,
      gglSub: verified.sub,
      emailVerifiedAt: existing?.emailVerifiedAt ?? new Date(),
    })
  revalidateTag('user' + userExist.id, 'default')

  await createCookie(userExist.id)
  console.log(`[AUTH] route=google_check email=${email} ms=${Date.now() - start} result=success`)
  // '/dashboard', or '/oauth/consent' when a validated ChatGPT authorization is pending.
  redirect(await postLoginDestination())
}

export async function checkFacebookUser(input: { accessToken?: string }) {
  const start = Date.now()

  const verified = await verifyFacebookAccessToken(input?.accessToken)
  if (verified.ok === false) {
    console.warn(`[AUTH] route=facebook_check ms=${Date.now() - start} result=fail reason=${verified.reason}`)
    if (verified.reason === 'no_email') {
      return { fail: true as const, msg: 'פייסבוק לא החזיר אימייל. אפשר להתחבר עם גוגל או עם מייל.' }
    }
    return { fail: true as const, msg: 'ההתחברות נכשלה, נסה שוב' }
  }

  const facebookSub = verified.identity.sub
  const email = normalizeEmail(verified.identity.email)
  const bySub = await getUserByFacebookSub(facebookSub)
  const byEmail = await getUserByEmail(email)
  const resolution = resolveFacebookLogin({ facebookSub, bySub, byEmail })

  if (resolution.kind === 'reject') {
    const msg =
      resolution.reason === 'suspended'
        ? 'המשתמש מושהה'
        : 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.'
    console.log(`[AUTH] route=facebook_check email=${email} ms=${Date.now() - start} result=fail reason=${resolution.reason}`)
    return { fail: true as const, msg }
  }

  if (resolution.kind === 'register') {
    if (!isFacebookUserAuthOpenToNewAgencies()) {
      console.log(`[AUTH] route=facebook_check email=${email} ms=${Date.now() - start} result=fail reason=not_allowlisted`)
      return { fail: true as const, msg: 'התחברות עם Facebook אינה זמינה לחשבון זה' }
    }
    await setFacebookLoginProof({
      facebookSub,
      name: verified.identity.name,
      picture: verified.identity.picture,
    })
    console.log(`[AUTH] route=facebook_check email=${email} ms=${Date.now() - start} result=fail reason=not_found`)
    return { fail: true as const, register: true as const, email, name: verified.identity.name ?? '' }
  }

  const agencyId = Number((bySub ?? byEmail)?.agencyId)
  if (!canUseFacebookUserAuth(agencyId)) {
    console.log(`[AUTH] route=facebook_check email=${email} ms=${Date.now() - start} result=fail reason=not_allowlisted`)
    return { fail: true as const, msg: 'התחברות עם Facebook אינה זמינה לחשבון זה' }
  }

  const existing = await db('users').where({ id: resolution.userId }).first('emailVerifiedAt', 'facebookSub')
  if (existing?.facebookSub && existing.facebookSub !== facebookSub) {
    console.warn(`[AUTH] route=facebook_check email=${email} ms=${Date.now() - start} result=fail reason=conflict`)
    return { fail: true as const, msg: 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.' }
  }

  if (resolution.verifyEmail && !existing?.emailVerifiedAt) {
    await revokeUserSessions(resolution.userId)
    console.warn('[AUTH] first email verification — prior sessions revoked', { userId: resolution.userId })
  }

  const patch: Record<string, unknown> = {}
  if (verified.identity.picture) patch.picture = verified.identity.picture
  if (resolution.attachFacebookSub && !existing?.facebookSub) patch.facebookSub = facebookSub
  if (resolution.verifyEmail) patch.emailVerifiedAt = existing?.emailVerifiedAt ?? new Date()

  if (Object.keys(patch).length) {
    await db('users').where({ id: resolution.userId }).update(patch)
    revalidateTag('user' + resolution.userId, 'default')
  }

  await clearFacebookLoginProof()
  await createCookie(resolution.userId)
  console.log(`[AUTH] route=facebook_check email=${email} ms=${Date.now() - start} result=success`)
  // '/dashboard', or '/oauth/consent' when a validated ChatGPT authorization is pending.
  redirect(await postLoginDestination())
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
  await clearFacebookLoginProof()
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

  /**
   * Resolved per request, never from the module-level constant. That constant is
   * computed when the module is first evaluated, which for a prerendered page is
   * BUILD time — and APP_HOST, the variable that names the staging origin, is
   * marked sensitive and does not exist during a build. Calling it here pins the
   * link to the environment that is actually issuing the token.
   */
  const magicLink = `${resolveBaseUrl()}/api/magic?token=${token}&email=${encodeURIComponent(email)}`

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
