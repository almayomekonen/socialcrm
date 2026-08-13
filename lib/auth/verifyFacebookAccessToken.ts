import { GRAPH_BASE } from '@/lib/facebook/graph'

const FETCH_TIMEOUT_MS = 8000

export type FacebookIdentity = { sub: string; email: string; name?: string; picture?: string }

export type FacebookVerifyResult =
  | { ok: true; identity: FacebookIdentity }
  | { ok: false; reason: 'invalid_token' | 'no_email' | 'config' }

async function graphJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Verify a Facebook USER access token with the SocialCRM Login app
 * (AUTH_FACEBOOK_APP_ID). Never uses META_APP_ID — that app is Page/WhatsApp only.
 * Identity is trusted only after debug_token says the token is valid for the auth
 * app and is a USER token (never a Page token from Page-connect).
 */
export async function verifyFacebookAccessToken(accessToken: unknown): Promise<FacebookVerifyResult> {
  if (typeof accessToken !== 'string' || !accessToken) {
    return { ok: false, reason: 'invalid_token' }
  }

  const appId = process.env.AUTH_FACEBOOK_APP_ID
  const appSecret = process.env.AUTH_FACEBOOK_APP_SECRET
  if (!appId || !appSecret) {
    console.error('[AUTH] AUTH_FACEBOOK_APP_ID / AUTH_FACEBOOK_APP_SECRET is not set — cannot verify Facebook token')
    return { ok: false, reason: 'config' }
  }

  const appToken = `${appId}|${appSecret}`
  const debugUrl =
    `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(accessToken)}` +
    `&access_token=${encodeURIComponent(appToken)}`
  const debugBody = (await graphJson(debugUrl)) as {
    data?: { is_valid?: boolean; app_id?: string; type?: string; user_id?: string }
  } | null

  const data = debugBody?.data
  if (
    !data?.is_valid ||
    String(data.app_id) !== String(appId) ||
    data.type !== 'USER' ||
    typeof data.user_id !== 'string' ||
    !data.user_id
  ) {
    return { ok: false, reason: 'invalid_token' }
  }

  const meUrl =
    `${GRAPH_BASE}/me?fields=id,name,email,picture.type(large)` +
    `&access_token=${encodeURIComponent(accessToken)}`
  const me = (await graphJson(meUrl)) as {
    id?: string
    name?: string
    email?: string
    picture?: { data?: { url?: string } }
  } | null

  if (!me || String(me.id) !== String(data.user_id)) {
    return { ok: false, reason: 'invalid_token' }
  }

  if (typeof me.email !== 'string' || !me.email.trim()) {
    return { ok: false, reason: 'no_email' }
  }

  const picture = typeof me.picture?.data?.url === 'string' ? me.picture.data.url : undefined
  return {
    ok: true,
    identity: {
      sub: String(me.id),
      email: me.email,
      name: typeof me.name === 'string' ? me.name : undefined,
      picture,
    },
  }
}
