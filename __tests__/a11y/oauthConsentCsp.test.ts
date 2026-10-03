// OAuth consent CSP — route-specific form-action.
//
// The consent form POSTs to our origin and the response 303-redirects to the
// OAuth client's registered callback (claude.ai / chatgpt.com). Browsers apply
// `form-action` to that redirect chain, so the enforced `form-action 'self'`
// blocked the callback at the Claude checkpoint. /oauth/consent therefore
// carries a form-action that also allows exactly the two callback origins; every
// other page keeps 'self'. Both CSP keys are re-set on that route so no stricter
// self-only policy remains (a later Next.js header rule REPLACES the same key).
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect, beforeAll } from 'vitest'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'

type Rule = { source: string; has?: unknown[]; headers: { key: string; value: string }[] }
let rules: Rule[]

beforeAll(async () => {
  rules = await (await import('../../next.config.mjs')).default.headers()
})

/** Next's composition: every matching rule in order; a later value for the same key replaces the earlier one. */
function effectiveHeaders(path: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const r of rules) {
    if (r.has) continue // cookie-conditional rules set no CSP
    if (!getPathMatch(r.source)(path)) continue
    for (const h of r.headers) out.set(h.key.toLowerCase(), [h.value])
  }
  return out
}
const formAction = (csp: string) => csp.split('; ').find((d) => d.startsWith('form-action'))
const withoutFormAction = (csp: string) =>
  csp
    .split('; ')
    .filter((d) => !d.startsWith('form-action'))
    .join('; ')

describe('/oauth/consent CSP', () => {
  test("the enforced policy allows exactly 'self', https://chatgpt.com and https://claude.ai", () => {
    const csp = effectiveHeaders('/oauth/consent').get('content-security-policy')!
    expect(csp).toHaveLength(1)
    expect(formAction(csp[0])).toBe("form-action 'self' https://chatgpt.com https://claude.ai")
  })

  test('the report-only policy mirrors the consent exception (no false-positive reports)', () => {
    const ro = effectiveHeaders('/oauth/consent').get('content-security-policy-report-only')!
    expect(ro).toHaveLength(1)
    expect(formAction(ro[0])).toBe("form-action 'self' https://chatgpt.com https://claude.ai")
  })

  test('no wildcard, scheme-wide or extra origin is allowed', () => {
    for (const key of ['content-security-policy', 'content-security-policy-report-only']) {
      const fa = formAction(effectiveHeaders('/oauth/consent').get(key)![0])!
      expect(fa).not.toContain('*')
      expect(fa.split(' ')).not.toContain('https:')
      expect(fa.split(' ').slice(1).sort()).toEqual(["'self'", 'https://chatgpt.com', 'https://claude.ai'].sort())
    }
  })

  test('no second, stricter self-only enforced policy remains on the consent page', () => {
    // Every rule matching the path that sets an enforced CSP: the LAST one wins,
    // and it must be the consent one. No matching rule after it sets the key.
    const matching = rules.filter((r) => !r.has && getPathMatch(r.source)('/oauth/consent'))
    const setters = matching.filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy'))
    expect(setters.map((r) => r.source)).toEqual(['/:path*', '/oauth/consent'])
    const final = effectiveHeaders('/oauth/consent').get('content-security-policy')![0]
    expect(final).not.toMatch(/form-action 'self'(;|$)/)
  })

  test('every other directive is identical to the global policy', () => {
    const consent = effectiveHeaders('/oauth/consent')
    const global = effectiveHeaders('/dashboard')
    for (const key of ['content-security-policy', 'content-security-policy-report-only']) {
      expect(withoutFormAction(consent.get(key)![0])).toBe(withoutFormAction(global.get(key)![0]))
    }
  })
})

describe('every other page keeps form-action self', () => {
  test.each([
    '/',
    '/dashboard',
    '/auth',
    '/api/oauth/consent',
    '/api/oauth/authorize',
    '/api/mcp',
    '/oauth/consent/extra',
    '/settings/integrations',
  ])('%s', (path) => {
    const h = effectiveHeaders(path)
    expect(formAction(h.get('content-security-policy')![0])).toBe("form-action 'self'")
    expect(formAction(h.get('content-security-policy-report-only')![0])).toBe("form-action 'self'")
  })
})
