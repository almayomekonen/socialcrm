/**
 * VAPID configuration — spec §23.2.
 *
 * Any missing variable ⇒ `not_configured`. Never throws, never crashes the
 * process. The subscribe route and client lifecycle report this state
 * explicitly so the UI can say "push is not set up" instead of failing opaque.
 *
 * P3.1 does NOT send push. This module only answers "are the keys present so a
 * browser can subscribe?" Delivery remains gated on NOTIFICATIONS_PUSH_ENABLED
 * (still off) and is out of scope until P3.2+.
 */

export type VapidStatus = 'configured' | 'not_configured'

export type VapidConfig = {
  status: VapidStatus
  /** Env var names that are absent or empty. Empty when configured. */
  missing: string[]
  /**
   * Public key the browser needs for `pushManager.subscribe`. Prefer the
   * server-side public key when present; fall back to NEXT_PUBLIC so a
   * partially-wired env still reports what the client would use.
   */
  publicKey: string | null
  /** True only when all four documented vars are non-empty. */
  subject: string | null
}

const REQUIRED = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY'] as const

function read(name: (typeof REQUIRED)[number]): string {
  return (process.env[name] ?? '').trim()
}

/**
 * Fail-soft: reads process.env on every call (same discipline as flags.ts —
 * flipping keys in a running process must not require a restart to observe).
 */
export function getVapidConfig(): VapidConfig {
  const missing = REQUIRED.filter((name) => !read(name))
  const publicKey = read('VAPID_PUBLIC_KEY') || read('NEXT_PUBLIC_VAPID_PUBLIC_KEY') || null
  const subject = read('VAPID_SUBJECT') || null

  if (missing.length > 0) {
    return { status: 'not_configured', missing: [...missing], publicKey, subject }
  }

  // Both public keys must agree when both are set — a mismatch would let the
  // browser subscribe with a key the server cannot sign with.
  const serverPub = read('VAPID_PUBLIC_KEY')
  const clientPub = read('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  if (serverPub !== clientPub) {
    return {
      status: 'not_configured',
      missing: ['VAPID_PUBLIC_KEY_MISMATCH'],
      publicKey: serverPub,
      subject,
    }
  }

  return {
    status: 'configured',
    missing: [],
    publicKey: serverPub,
    subject,
  }
}

export function isVapidConfigured(): boolean {
  return getVapidConfig().status === 'configured'
}
