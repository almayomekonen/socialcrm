import { SmartbeeConfigError, smartbeeClientCredentials } from './config'
import { SmartbeeTransportError, smartbeeFetch, type SmartbeeFetch, type SmartbeeHttpResult } from './http'
import type { IntegrationEnvironment } from '@/lib/integrations/core/types'

/**
 * SmartBee's JWT: `POST /login/authenticate` with OUR clientId + password returns
 * `{ token, expirationUtcDate }`, valid 7 days, with no refresh endpoint.
 *
 * Cached per server instance and per environment, and replaced one hour before
 * it expires (the guide's recommendation). On an HTTP 401 the token is replaced
 * ONCE and the request repeated once, never in a loop. The token is never
 * stored in the database and never logged.
 */

export class SmartbeeAuthError extends Error {
  constructor(public reason: 'missing_credentials' | 'invalid_credentials' | 'production_disabled' | 'unavailable') {
    super(`smartbee.auth.${reason}`)
    this.name = 'SmartbeeAuthError'
  }
}

export type SmartbeeAuthDeps = { fetchImpl?: SmartbeeFetch; nowMs?: () => number }

const REFRESH_MARGIN_MS = 60 * 60 * 1000
/** Used only when SmartBee's expiration date is unreadable: well inside the documented 7 days. */
const FALLBACK_LIFETIME_MS = 24 * 60 * 60 * 1000

const cache = new Map<IntegrationEnvironment, { token: string; expiresAtMs: number }>()

async function login(env: IntegrationEnvironment, deps: SmartbeeAuthDeps, nowMs: number): Promise<string> {
  let credentials: { clientId: string; password: string }
  try {
    credentials = smartbeeClientCredentials(env)
  } catch (err) {
    if (err instanceof SmartbeeConfigError) throw new SmartbeeAuthError('missing_credentials')
    throw err
  }
  let res: SmartbeeHttpResult
  try {
    res = await smartbeeFetch({ env, method: 'POST', path: '/login/authenticate', body: credentials, fetchImpl: deps.fetchImpl })
  } catch (err) {
    if (err instanceof SmartbeeConfigError) throw new SmartbeeAuthError('production_disabled')
    if (err instanceof SmartbeeTransportError) throw new SmartbeeAuthError('unavailable')
    throw err
  }
  if (res.status === 400 || res.status === 401) throw new SmartbeeAuthError('invalid_credentials')
  const body = res.body as { token?: unknown; expirationUtcDate?: unknown } | null
  if (res.status !== 200 || typeof body?.token !== 'string' || !body.token) throw new SmartbeeAuthError('unavailable')

  const parsed = typeof body.expirationUtcDate === 'string' ? Date.parse(body.expirationUtcDate) : Number.NaN
  const expiresAtMs = Number.isFinite(parsed) ? parsed : nowMs + FALLBACK_LIFETIME_MS
  cache.set(env, { token: body.token, expiresAtMs })
  return body.token
}

export async function smartbeeToken(env: IntegrationEnvironment, opts: { force?: boolean } & SmartbeeAuthDeps = {}): Promise<string> {
  const nowMs = (opts.nowMs ?? Date.now)()
  const cached = cache.get(env)
  if (!opts.force && cached && cached.expiresAtMs - REFRESH_MARGIN_MS > nowMs) return cached.token
  cache.delete(env)
  return login(env, opts, nowMs)
}

/** Runs `call` with a valid JWT; on HTTP 401 replaces the token once and runs it once more. */
export async function withSmartbeeAuth(
  env: IntegrationEnvironment,
  call: (token: string) => Promise<SmartbeeHttpResult>,
  deps: SmartbeeAuthDeps = {},
): Promise<SmartbeeHttpResult> {
  const first = await call(await smartbeeToken(env, deps))
  if (first.status !== 401) return first
  return call(await smartbeeToken(env, { ...deps, force: true }))
}

/** Test seam only. */
export function __resetSmartbeeTokenCache(): void {
  cache.clear()
}
