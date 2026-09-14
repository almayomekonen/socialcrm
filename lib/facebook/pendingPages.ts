import { decrypt } from '@/db/auth'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'

/**
 * The short-lived `fb_pages` cookie between the OAuth callback and Page
 * selection.
 *
 * WHAT CHANGED AND WHY. The cookie was a signed (not encrypted) JWT, and its
 * decoded `pages` — each with a live Page access token — were passed straight
 * into client components and posted back by the browser to /connect, which
 * trusted the token it was given. Now:
 *   · the whole payload is ONE AES-256-GCM envelope (SECRETS_ENC_KEY). GCM
 *     authenticates as well as encrypts, so no JWT signature is needed on top,
 *     and one base64 layer keeps the cookie the size the JWT was — the ~4 KB
 *     cookie still holds as many Pages as before;
 *   · the envelope carries its own 10-minute expiry and the user it was issued to;
 *   · the browser only ever receives `{ id, name }` (`toClientPages`);
 *   · /connect resolves the token server-side from this cookie by Page id and
 *     ignores anything the client sends.
 * Same rule as the WhatsApp phone picker (`wa_phones`): display data to the
 * client, credentials stay on the server.
 */

export const PENDING_PAGES_COOKIE = 'fb_pages'
export const PENDING_PAGES_MAX_AGE_S = 60 * 10

const ENVELOPE_PREFIX = 'scmp1.'

export type PendingPageForClient = { id: string; name: string }

export type PendingPages = {
  pages: { id: string; name: string; token: string }[]
  grantedScopes: string[]
}

type Envelope = {
  userId: number
  exp: number
  grantedScopes: string[]
  pages: { id: string; name: string; access_token: string }[]
}

/** Throws if SECRETS_ENC_KEY is unavailable — the caller turns that into a clear failure. */
export function sealPendingPagesCookie(
  input: { pages: { id: string; name: string; access_token: string }[]; userId: number; grantedScopes: string[] },
  now: number = Date.now(),
): string {
  const envelope: Envelope = {
    userId: input.userId,
    exp: now + PENDING_PAGES_MAX_AGE_S * 1000,
    grantedScopes: input.grantedScopes,
    pages: input.pages.map(({ id, name, access_token }) => ({ id, name, access_token })),
  }
  return ENVELOPE_PREFIX + encryptSecret(JSON.stringify(envelope))
}

function normalize(raw: { pages?: unknown; grantedScopes?: unknown }): PendingPages | null {
  if (!Array.isArray(raw.pages)) return null
  const pages: PendingPages['pages'] = []
  for (const p of raw.pages as { id?: unknown; name?: unknown; access_token?: unknown }[]) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue
    if (typeof p.access_token !== 'string' || !p.access_token) continue
    pages.push({ id: p.id, name: p.name, token: p.access_token })
  }
  const grantedScopes = Array.isArray(raw.grantedScopes)
    ? (raw.grantedScopes as unknown[]).filter((s): s is string => typeof s === 'string' && s.length > 0)
    : []
  return { pages, grantedScopes }
}

/**
 * Server-only read. Null for a missing, expired, tampered or foreign cookie, or
 * one that cannot be opened. Also accepts the pre-change signed JWT for the ten
 * minutes a cookie issued before deploy can still be alive.
 */
export async function readPendingPages(
  cookieValue: string | undefined,
  userId: number,
  now: number = Date.now(),
): Promise<PendingPages | null> {
  if (!cookieValue) return null

  if (cookieValue.startsWith(ENVELOPE_PREFIX)) {
    try {
      const env = JSON.parse(decryptSecret(cookieValue.slice(ENVELOPE_PREFIX.length))) as Partial<Envelope>
      if (env.userId !== userId || typeof env.exp !== 'number' || env.exp <= now) return null
      return normalize(env)
    } catch {
      return null
    }
  }

  try {
    const payload = (await decrypt(cookieValue)) as { userId?: unknown; pages?: unknown; grantedScopes?: unknown } | null
    return payload && payload.userId === userId ? normalize(payload) : null
  } catch {
    return null
  }
}

/** The only view of pending Pages that may cross to a client component. */
export function toClientPages(pending: PendingPages | null): PendingPageForClient[] | null {
  if (!pending) return null
  return pending.pages.map(({ id, name }) => ({ id, name }))
}

/** Token and name for one pending Page, server-side. */
export function pendingPageToken(pending: PendingPages | null, pageId: string): { name: string; token: string } | null {
  const page = pending?.pages.find((p) => p.id === pageId)
  return page ? { name: page.name, token: page.token } : null
}
