// Cache correctness + the override's plumbing, asserted against the real proxy
// and the real Next config.
//
// THE RISK. This app serves DIFFERENT HTML to a phone and to a desktop for the
// SAME URL. Any cache that does not know that is entitled to hand a desktop
// visitor a mobile shell, or a phone a desktop table.
//
// WHAT WAS MEASURED (against a running server, not assumed): Next takes sole
// ownership of `Vary` on rendered App Router responses — a value set in
// middleware OR in `next.config.mjs` is replaced by Next's own router values.
// The real protection is that every device-dependent response is dynamic
// (`cookies()` + `headers()` in the (app) layout) and therefore served
// `Cache-Control: no-store`, which forbids storing the response at all. The
// `Vary` rule in next.config is the explicit declaration of intent at the one
// layer that can express it. See the block in next.config.mjs.
//
// Guarantees locked in (do not weaken):
//   12. User-Agent is declared in cache variance for authenticated responses…
//       …scoped by session cookie, so public marketing pages keep their
//       cacheability and Next's RSC router Vary is never overwritten globally.
//   The override header is proxy-owned: inbound copies are stripped, always.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, beforeEach, afterEach, test, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import nextConfig from '@/next.config.mjs'
import { DEVICE_OVERRIDE_HEADER } from '@/lib/deviceOverride'

const NODE = process.env.NODE_ENV
const setNode = (v: string | undefined) => {
  if (v === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
  else (process.env as Record<string, string | undefined>).NODE_ENV = v
}
beforeEach(() => setNode('test'))
afterEach(() => setNode(NODE))

/** A signed-in request, which is what every device-dependent route is. */
function signedIn(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    headers: { cookie: 'user=fake-session-token', ...headers },
  })
}

/**
 * Next encodes middleware request-header rewrites onto the response as
 * `x-middleware-request-<name>`. Reading it back is how we assert what the app
 * will actually receive, rather than what we hoped we set.
 */
function forwardedOverride(res: Response): string | null {
  return res.headers.get(`x-middleware-request-${DEVICE_OVERRIDE_HEADER}`)
}

type HeaderRule = {
  source: string
  has?: { type: string; key: string }[]
  headers: { key: string; value: string }[]
}

async function headerRules(): Promise<HeaderRule[]> {
  return (await nextConfig.headers()) as HeaderRule[]
}

const varyRules = (rules: HeaderRule[]) =>
  rules.filter((r) => r.headers.some((h) => h.key.toLowerCase() === 'vary'))

describe('12. User-Agent is included in cache variance', () => {
  test('a Vary: User-Agent rule is declared', async () => {
    const rules = varyRules(await headerRules())
    expect(rules).toHaveLength(1)
    expect(rules[0].headers.find((h) => h.key.toLowerCase() === 'vary')?.value).toBe('User-Agent')
  })

  test('it is scoped to authenticated requests by the session cookie', async () => {
    // Scoping is the whole safety argument: an unconditional Vary: User-Agent
    // would shard the marketing CDN across every User-Agent string on earth for
    // pages that are byte-identical on every device.
    const [rule] = varyRules(await headerRules())
    expect(rule.has).toEqual([{ type: 'cookie', key: 'user' }])
  })

  test('it never rides on the unconditional /:path* security-header rule', async () => {
    // That rule applies to every anonymous request, including the public
    // marketing pages. Vary must not leak onto it.
    const rules = await headerRules()
    const unconditional = rules.filter((r) => r.source === '/:path*' && !r.has)
    expect(unconditional.length).toBeGreaterThan(0)
    for (const r of unconditional) {
      expect(r.headers.map((h) => h.key.toLowerCase())).not.toContain('vary')
    }
  })

  test('the existing security headers are untouched by the addition', async () => {
    const rules = await headerRules()
    const security = rules.find((r) => r.source === '/:path*' && !r.has)!
    const keys = security.headers.map((h) => h.key)
    for (const k of [
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Content-Security-Policy-Report-Only',
    ]) {
      expect(keys, k).toContain(k)
    }
  })

  test('the proxy sets no Vary — it was measured not to survive, so it is not faked', async () => {
    // Next replaces Vary on every rendered App Router response. A middleware
    // value that never reaches the client is protection in name only.
    const res = await proxy(signedIn('/dashboard'))
    expect(res.headers.get('Vary')).toBeNull()
  })
})

describe('the device override is proxy-owned', () => {
  test('development: ?device=phone is forwarded to the app as a request header', async () => {
    setNode('development')
    const res = await proxy(signedIn('/dashboard?device=phone'))
    expect(forwardedOverride(res)).toBe('phone')
  })

  test('development: ?device=desktop is forwarded', async () => {
    setNode('development')
    const res = await proxy(signedIn('/leads?device=desktop'))
    expect(forwardedOverride(res)).toBe('desktop')
  })

  test('development: an unrecognised value forwards nothing', async () => {
    setNode('development')
    for (const v of ['tablet', 'PHONE', '1', '']) {
      const res = await proxy(signedIn(`/dashboard?device=${v}`))
      expect(forwardedOverride(res), v).toBeNull()
    }
  })

  test('PRODUCTION: ?device=phone is not forwarded at all', async () => {
    setNode('production')
    const res = await proxy(signedIn('/dashboard?device=phone'))
    expect(forwardedOverride(res)).toBeNull()
  })

  test('an inbound override header is STRIPPED — a client cannot inject it', async () => {
    // Production is already safe twice over (the proxy will not set it, and
    // lib/device.ts will not read it), but the header is deleted in EVERY
    // environment so it can only ever mean "the proxy read this off the URL".
    for (const env of ['production', 'development', 'test']) {
      setNode(env)
      const res = await proxy(signedIn('/dashboard', { [DEVICE_OVERRIDE_HEADER]: 'phone' }))
      expect(forwardedOverride(res), env).toBeNull()
    }
  })

  test('development: a spoofed header loses to the absent query param', async () => {
    setNode('development')
    const res = await proxy(signedIn('/dashboard', { [DEVICE_OVERRIDE_HEADER]: 'phone' }))
    expect(forwardedOverride(res)).toBeNull()
  })

  test('the override never bypasses authentication', async () => {
    setNode('development')
    // No session cookie: the sign-in redirect happens exactly as before, and the
    // override plays no part in it.
    const res = await proxy(new NextRequest(new URL('/dashboard?device=phone', 'http://localhost:3000')))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/auth')
    expect(forwardedOverride(res)).toBeNull()
  })
})
