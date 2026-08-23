import { timingSafeEqual } from 'crypto'

/**
 * The parts of a Grow webhook that every Grow endpoint must do identically:
 * environment guarding, body parsing, envelope unwrapping and secret
 * verification.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED. Grow delivers different webhook types
 * to different endpoints — the transaction webhook, the recurring webhook
 * (charge #2 onward) and the recurring-failure webhook are separate
 * subscriptions. What must NOT vary between them is the security envelope. A
 * second endpoint with its own hand-copied auth is how one of them ends up a
 * version behind the other, so the checks live here once and every route calls
 * the same code.
 *
 * Extracted verbatim from the transaction route: identical order, identical
 * comparisons, identical failure modes. Nothing about classification, ownership
 * resolution, entitlement or persistence is here — those differ per webhook type
 * and belong to their own routes.
 */

export type AppEnv = 'local' | 'staging' | 'test' | 'production'
export type GrowMode = 'sandbox' | 'production'

function isAppEnv(value: string | undefined): value is AppEnv {
  return value === 'local' || value === 'staging' || value === 'test' || value === 'production'
}

function isGrowMode(value: string | undefined): value is GrowMode {
  return value === 'sandbox' || value === 'production'
}

/** Constant-time compare. Length is checked first because timingSafeEqual throws on a mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Refuse to process a payment webhook in an environment that is not configured
 * to receive one. Throws; callers answer 500 rather than leaking the reason.
 */
export function assertWebhookEnv(host: string): { env: AppEnv; mode: GrowMode } {
  const ENV = process.env.APP_ENV
  const MODE = process.env.GROW_MODE

  if (!isAppEnv(ENV)) {
    throw new Error('🚨 APP_ENV must be local, staging, test, or production')
  }
  if (!isGrowMode(MODE)) {
    throw new Error('🚨 GROW_MODE must be sandbox or production')
  }
  if (ENV === 'local' && MODE !== 'sandbox') {
    throw new Error('🚨 LOCAL must use sandbox payments')
  }
  if (ENV === 'staging' && MODE !== 'sandbox') {
    throw new Error('🚨 STAGING must use sandbox payments')
  }
  if (ENV === 'test' && MODE !== 'sandbox') {
    throw new Error('🚨 TEST must use sandbox payments')
  }
  if (ENV === 'production' && MODE !== 'production') {
    throw new Error('🚨 PROD must use real payments')
  }
  if (ENV === 'production') {
    const appHost = process.env.APP_HOST
    if (!appHost || !host.includes(appHost)) {
      throw new Error('🚨 Host mismatch in production')
    }
  }

  return { env: ENV, mode: MODE }
}

/**
 * `body.data ?? body`. The PaymentLinks webhook wraps its fields in a `data`
 * envelope alongside a request-level `err`/`status`; other Grow webhook types
 * are documented flat. Unwrapping the same way everywhere means a route never
 * has to care which shape arrived.
 */
export function unwrapPayload(body: any): any {
  return body?.data ?? body
}

/**
 * The shared secret, under either spelling Grow uses.
 *
 * The transaction and recurring webhooks document `webhookKey`; the
 * recurring-failure webhook documents `webhook_key`. Accepting both is not a
 * weakening — the same secret is still compared in constant time, and a payload
 * carrying neither is refused. It only avoids a second, subtly different
 * verification for the snake_case type.
 *
 * Returns a discriminated result so callers can answer 500 for "we are
 * misconfigured" and 401 for "you are not Grow" without conflating them.
 */
export type SecretCheck = { ok: true } | { ok: false; reason: 'not_configured' | 'invalid' }

export function verifyWebhookSecret(payload: any): SecretCheck {
  const secret = process.env.GROW_WEBHOOK_SECRET
  if (!secret) return { ok: false, reason: 'not_configured' }
  const provided: unknown = payload?.webhookKey ?? payload?.webhook_key
  if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true }
}

/**
 * Grow's mandate identifiers, under the spellings each webhook type documents:
 * `directDebitId` on the transaction and recurring webhooks, and
 * `regular_payment_id` on the recurring-failure webhook. Both are documented as
 * "קוד הוראת קבע ולא קוד עסקה" — the standing order, never a single charge.
 *
 * Placeholders are rejected: Grow emits its full envelope on every transaction,
 * so a key being present proves nothing. Only a value that could be a real
 * identifier is returned.
 */
export function readMandateId(payload: any): string | null {
  const raw =
    payload?.directDebitId ?? payload?.direct_debit_id ?? payload?.regular_payment_id ?? payload?.regularPaymentId
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (['0', 'null', 'undefined', 'false', '-1'].includes(s.toLowerCase())) return null
  return s
}

/**
 * Enough of an email to correlate an event with a stored row, and no more:
 * `ala***@gmail.com`. Never the full address.
 */
export function maskEmail(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '(absent)'
  const e = raw.trim()
  const at = e.lastIndexOf('@')
  if (at < 1) return `${e.slice(0, 3)}***`
  return `${e.slice(0, 3)}***@${e.slice(at + 1)}`
}
