import { SignJWT } from 'jose'
import { cookies } from 'next/headers'
import { decrypt } from '@/db/auth'

/**
 * Short-lived proof that Meta verified this Facebook user id.
 * Distinct from the SocialCRM session cookie (`typ: 'session'`) and from
 * Page-connect's `fb_pages` cookie. Never put SocialCRM `users.id` in `id`.
 */
export const FB_LOGIN_PROOF_TYPE = 'fb_login'
export const FB_LOGIN_COOKIE = 'fb_login'
const TTL_MINUTES = 10

export type FacebookLoginProof = {
  facebookSub: string
  name?: string
  picture?: string
}

function signingKey() {
  if (!process.env.JWT_SECRET) {
    throw new Error('[auth] JWT_SECRET is not set')
  }
  return new TextEncoder().encode(process.env.JWT_SECRET)
}

export async function setFacebookLoginProof(identity: FacebookLoginProof): Promise<void> {
  const token = await new SignJWT({
    typ: FB_LOGIN_PROOF_TYPE,
    facebookSub: identity.facebookSub,
    name: identity.name,
    picture: identity.picture,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_MINUTES}m`)
    .sign(signingKey())

  const cokis = await cookies()
  cokis.set(FB_LOGIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: TTL_MINUTES * 60,
    path: '/',
  })
}

export async function readFacebookLoginProof(): Promise<FacebookLoginProof | null> {
  const cokis = await cookies()
  const raw = cokis.get(FB_LOGIN_COOKIE)?.value
  if (!raw) return null

  try {
    const payload = await decrypt(raw)
    if (payload?.typ !== FB_LOGIN_PROOF_TYPE) return null
    // Session tokens use `id` = SocialCRM users.id. A proof must never carry it.
    if (payload.id !== undefined) return null
    if (typeof payload.facebookSub !== 'string' || !payload.facebookSub.trim()) return null
    return {
      facebookSub: payload.facebookSub,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    }
  } catch {
    return null
  }
}

export async function clearFacebookLoginProof(): Promise<void> {
  const cokis = await cookies()
  cokis.delete(FB_LOGIN_COOKIE)
}

/** Registration may attach facebookSub only from a verified proof — never from client data. */
export function facebookSubFromProof(proof: FacebookLoginProof | null): string | undefined {
  const sub = proof?.facebookSub
  if (typeof sub !== 'string' || !sub.trim()) return undefined
  return sub
}

export function isFacebookSubUniqueViolation(err: {
  code?: string
  constraint?: string
  detail?: string
} | null): boolean {
  if (!err || err.code !== '23505') return false
  const haystack = `${err.constraint ?? ''} ${err.detail ?? ''}`.toLowerCase()
  return haystack.includes('facebooksub')
}
