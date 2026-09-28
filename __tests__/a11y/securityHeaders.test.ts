// Security headers — the invariants, and the two holes that were proven live.
//
// These assertions exist because the previous policy LOOKED complete and was
// not: it shipped report-only with no `report-uri`, so nothing ever measured it,
// and it was missing two origins that a live `securitypolicyviolation` probe on
// getsocialcrm.com/auth caught. The tests below pin the fixes and the two
// deliberate refusals (no COEP, no Trusted Types) so neither is "tidied up" by
// someone chasing a scanner score.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect, beforeAll } from 'vitest'

let headers: Record<string, string>

beforeAll(async () => {
  const config = (await import('../../next.config.mjs')).default
  const rules = await config.headers()
  const global = rules.find((r: { source: string }) => r.source === '/:path*')
  headers = Object.fromEntries(global.headers.map((h: { key: string; value: string }) => [h.key, h.value]))
})

describe('Content-Security-Policy', () => {
  test('is ENFORCED, not only report-only — the actual scanner finding', () => {
    expect(headers['Content-Security-Policy']).toBeTruthy()
  })

  test('reports violations somewhere, so tightening can be evidence-driven', () => {
    // The original defect: report-only with nowhere to report.
    expect(headers['Content-Security-Policy']).toContain('report-uri /api/security/csp-report')
    expect(headers['Content-Security-Policy-Report-Only']).toContain('report-uri /api/security/csp-report')
  })

  test('allows the Google Sign-In stylesheet — proven main-document violation', () => {
    // style-src-elem https://accounts.google.com/gsi/style, observed live.
    // Without this, enforcing un-styles the login button.
    const styleSrc = headers['Content-Security-Policy'].split('; ').find((d) => d.startsWith('style-src'))
    expect(styleSrc).toContain('https://accounts.google.com')
  })

  test('the candidate policy allows Meta Pixel telemetry — the other proven violation', () => {
    // connect-src https://*.on.aws, POSTed by fbevents.js from the main document.
    const candidate = headers['Content-Security-Policy-Report-Only']
    const connectSrc = candidate.split('; ').find((d) => d.startsWith('connect-src'))
    expect(connectSrc).toContain('https://*.on.aws')
  })

  test('keeps the zero-breakage-risk directives strict', () => {
    const csp = headers['Content-Security-Policy']
    // None of these can block a resource the app legitimately loads, and they
    // are where most of the real value is.
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  test('lets the pdf.js worker load, including its blob: fallback', () => {
    expect(headers['Content-Security-Policy']).toContain("worker-src 'self' blob:")
  })

  test('the report-only policy is a real candidate, stricter than what is enforced', () => {
    const enforced = headers['Content-Security-Policy']
    const candidate = headers['Content-Security-Policy-Report-Only']
    expect(candidate).not.toEqual(enforced)
    // The one directive deliberately loose while authenticated surfaces are
    // unmeasured. If this ever matches, the candidate has stopped being a
    // tightening target and the two policies should be collapsed.
    // Compare the DIRECTIVE exactly: a substring check would match
    // "connect-src 'self' https://accounts.google.com…" against "https:".
    const directive = (csp: string, name: string) =>
      csp.split('; ').find((d) => d.startsWith(name + ' '))
    expect(directive(enforced, 'connect-src')).toBe("connect-src 'self' https:")
    expect(directive(candidate, 'connect-src')).not.toBe("connect-src 'self' https:")
  })
})

describe('cross-origin isolation is deliberately NOT enabled', () => {
  test('COEP is absent — require-corp would break the FB SDK, Picker and Cloudinary', () => {
    expect(headers['Cross-Origin-Embedder-Policy']).toBeUndefined()
  })

  test('COOP allows popups — Google Sign-In and WhatsApp Embedded Signup need the opener', () => {
    // `same-origin` severs window.opener for cross-origin popups, which is how
    // GSI returns the credential and how Embedded Signup postMessages back.
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups')
    expect(headers['Cross-Origin-Opener-Policy']).not.toBe('same-origin')
  })
})

describe('Trusted Types is deliberately NOT enabled', () => {
  test('require-trusted-types-for is absent while script.src sinks exist', () => {
    // Three app sinks (Google Picker loader, Facebook SDK loader, Meta Pixel)
    // plus Next/Turbopack's own chunk loader, none with a registered policy.
    // Enabling this breaks client-side navigation, not just the sinks.
    expect(headers['Content-Security-Policy']).not.toContain('require-trusted-types-for')
    expect(headers['Content-Security-Policy']).not.toContain('trusted-types')
  })
})

describe('the pre-existing headers still ship', () => {
  test.each([
    ['Strict-Transport-Security', 'max-age=63072000'],
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=()'],
  ])('%s', (key, expected) => {
    expect(headers[key]).toContain(expected)
  })
})

describe('Permissions-Policy allows the microphone to this origin only (/agent voice input)', () => {
  test('microphone=(self): first-party pages may ask; no iframe or third party can', () => {
    expect(headers['Permissions-Policy']).toContain('microphone=(self)')
    expect(headers['Permissions-Policy']).not.toMatch(/microphone=\(\*\)|microphone=\*/)
  })

  test('everything else stays denied', () => {
    for (const denied of ['camera=()', 'geolocation=()', 'payment=()']) {
      expect(headers['Permissions-Policy']).toContain(denied)
    }
  })
})
