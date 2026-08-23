// One secret per Grow endpoint — the isolation matrix.
//
// Grow generates each webhook's key itself and does not let the merchant edit
// it, so three webhook subscriptions mean three unrelated keys. A single shared
// secret could only be made to work by accepting any of them anywhere, and that
// is exactly the property that must not exist: /recurring grants paid time, so
// it must not be reachable with the transaction webhook's key.
//
// These exercise `verifyWebhookSecret` directly. The per-route suites prove each
// endpoint is wired to the right name; this proves the primitive itself has no
// fallback, for every ordered pair.
//
// No real secrets appear: all values are local constants.

import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { verifyWebhookSecret, type GrowWebhookSecretName } from '@/lib/payments/growWebhook'

const NAMES = [
  'GROW_WEBHOOK_SECRET',
  'GROW_RECURRING_WEBHOOK_SECRET',
  'GROW_RECURRING_FAILURE_WEBHOOK_SECRET',
] as const satisfies readonly GrowWebhookSecretName[]

/** A distinct, obviously-fake value per endpoint. */
const VALUE: Record<GrowWebhookSecretName, string> = {
  GROW_WEBHOOK_SECRET: 'fake-initial-secret-aaaaaaaaaaaa',
  GROW_RECURRING_WEBHOOK_SECRET: 'fake-recurring-secret-bbbbbbbb',
  GROW_RECURRING_FAILURE_WEBHOOK_SECRET: 'fake-failure-secret-cccccccccc',
}

/** All three configured at once — the real production shape. */
function stubAll() {
  for (const n of NAMES) vi.stubEnv(n, VALUE[n])
}

afterEach(() => vi.unstubAllEnvs())

describe('each secret authenticates its own endpoint and no other', () => {
  it.each(NAMES)('%s accepts its own key', (name) => {
    stubAll()
    expect(verifyWebhookSecret({ webhookKey: VALUE[name] }, name)).toEqual({ ok: true })
  })

  it.each(NAMES)('%s accepts its own key under the snake_case spelling', (name) => {
    stubAll()
    expect(verifyWebhookSecret({ webhook_key: VALUE[name] }, name)).toEqual({ ok: true })
  })

  /**
   * The full cross-product. Every ordered pair of DIFFERENT endpoints must be a
   * rejection — six cases, none of which may pass.
   */
  const crossPairs = NAMES.flatMap((expected) =>
    NAMES.filter((other) => other !== expected).map((other) => ({ expected, other })),
  )

  it.each(crossPairs)('$expected rejects the key belonging to $other', ({ expected, other }) => {
    stubAll()
    expect(verifyWebhookSecret({ webhookKey: VALUE[other] }, expected)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('all six cross-endpoint combinations are covered', () => {
    expect(crossPairs).toHaveLength(6)
  })
})

describe('missing configuration is distinguished from a wrong key', () => {
  it.each(NAMES)('%s empty reports not_configured, even with the others set', (name) => {
    stubAll()
    vi.stubEnv(name, '')
    // The other two remain correctly configured; they must not stand in.
    expect(verifyWebhookSecret({ webhookKey: VALUE[name] }, name)).toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })

  /**
   * Genuinely ABSENT, not merely empty. An empty string is not nullish, so a
   * `?? process.env.SOMETHING_ELSE` fallback would survive the empty-string case
   * above while silently accepting another endpoint's key here. This is the case
   * that actually catches a nullish-coalescing fallback.
   */
  it.each(NAMES)('%s absent reports not_configured and accepts nothing', (name) => {
    stubAll()
    vi.stubEnv(name, undefined)
    for (const candidate of NAMES) {
      expect(verifyWebhookSecret({ webhookKey: VALUE[candidate] }, name)).toEqual({
        ok: false,
        reason: 'not_configured',
      })
    }
  })

  it.each(NAMES)('%s set but key wrong reports invalid, not not_configured', (name) => {
    stubAll()
    expect(verifyWebhookSecret({ webhookKey: 'not-any-endpoints-key' }, name)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('a payload carrying no key at all is invalid, never accepted', () => {
    stubAll()
    for (const name of NAMES) {
      expect(verifyWebhookSecret({}, name)).toEqual({ ok: false, reason: 'invalid' })
      expect(verifyWebhookSecret(null, name)).toEqual({ ok: false, reason: 'invalid' })
      expect(verifyWebhookSecret({ webhookKey: 123 }, name)).toEqual({ ok: false, reason: 'invalid' })
    }
  })
})

describe('the primitive itself offers no way to chain secrets', () => {
  const src = fs.readFileSync('lib/payments/growWebhook.ts', 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('reads exactly one env var, by the caller-supplied name', () => {
    expect(code).toContain('const secret = process.env[secretName]')
    // no hardcoded fallback to any specific secret
    expect(code).not.toMatch(/process\.env\.GROW_\w*SECRET/)
    expect(code).not.toMatch(/process\.env\[[^\]]*\]\s*\?\?/)
  })

  it('requires the secret name — a default would be a fallback in disguise', () => {
    expect(code).toContain('secretName: GrowWebhookSecretName')
    expect(code).not.toMatch(/secretName[^)]*=\s*'GROW_/)
  })

  it('still compares in constant time', () => {
    expect(code).toContain('timingSafeEqual')
    expect(code).toContain('ab.length === bb.length && timingSafeEqual(ab, bb)')
    expect(code).toContain('safeEqual(provided, secret)')
  })

  it('every route names its own secret, and no route names another', () => {
    const expectations: Array<[string, GrowWebhookSecretName]> = [
      ['app/api/payments/grow/route.ts', 'GROW_WEBHOOK_SECRET'],
      ['app/api/payments/grow/recurring/route.ts', 'GROW_RECURRING_WEBHOOK_SECRET'],
      ['app/api/payments/grow/recurring-failure/route.ts', 'GROW_RECURRING_FAILURE_WEBHOOK_SECRET'],
    ]
    for (const [file, own] of expectations) {
      const body = fs.readFileSync(file, 'utf8')
      expect(body, file).toContain(`verifyWebhookSecret(payload, '${own}')`)
      for (const other of NAMES) {
        if (other === own) continue
        expect(body, `${file} must not reference ${other}`).not.toContain(other)
      }
    }
  })
})
