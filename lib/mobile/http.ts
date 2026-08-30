import 'server-only'
import { NextResponse } from 'next/server'

/**
 * The mobile API's single response envelope.
 *
 * One shape for every failure, because the client classifies by HTTP status and
 * then reads `error.code` for the specific reason. Free-form messages are for
 * humans reading logs; the client must never parse prose.
 *
 * NOTHING SENSITIVE CROSSES THIS BOUNDARY. Handlers pass a code from the union
 * below — never an exception message, a SQL error, or a stack. An internal
 * failure is always the opaque `server_error`.
 */

export type MobileErrorCode =
  // 401 — no credential, or one that is expired/tampered/revoked.
  | 'unauthorized'
  // 403 — authenticated, but not permitted.
  | 'forbidden'
  | 'suspended'
  | 'no_agency'
  // 403 — authenticated, but the agency has no active product access. Distinct
  // from `forbidden` so the client can show activation vs upgrade correctly.
  | 'trial_not_started'
  | 'subscription_required'
  // 400
  | 'invalid_request'
  /**
   * 404 — absent, OR present but not permitted.
   *
   * The two are deliberately indistinguishable: a separate "forbidden" would let
   * sequential ids be used to enumerate which records exist outside the caller's
   * permission set.
   */
  | 'not_found'
  // 429
  | 'rate_limited'
  // 500
  | 'server_error'

export function ok<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json(data as object, { status: init?.status ?? 200 })
}

/**
 * 204 No Content.
 *
 * A dedicated helper because `NextResponse.json(null, { status: 204 })` THROWS:
 * a 204 must carry no body at all, and the JSON helper always writes one. That
 * turned every logout into a 500 — the revocation itself succeeded, so the bug
 * was invisible except in the status code.
 */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 })
}

export function fail(
  code: MobileErrorCode,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, ...extra } }, { status })
}

/**
 * Reads the bearer credential.
 *
 * Header only — deliberately never a query parameter, which would land the
 * credential in access logs, proxy logs, and browser history.
 */
export function bearerFrom(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token.length > 0 ? token : null
}

/** Best-effort client IP for rate limiting and session labelling. Never trusted for auth. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  return xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}
