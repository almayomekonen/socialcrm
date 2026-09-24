import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The development surfaces must not exist on a deployment — any deployment, not
 * just the production one. Each is reachable by URL, so "nobody knows the path"
 * is not a control:
 *
 *   /api/dev/grow-mock/*              a fake Grow that confirms card setups
 *   /api/dev/email-automation-preview sends real mail (POST) and renders it (GET)
 *   /api/mobile/v1/auth/dev           issues a session without a password
 *
 * Vercel builds every deployment with NODE_ENV=production, preview included, so
 * that is the lock the first two rest on; the mock adds its own refusal on any
 * VERCEL* signal. These tests assert the refusals hold even when the enabling
 * variables are deliberately switched on, which is the case that matters: a
 * variable copied into the wrong environment must not open the door.
 */

const req = (url: string) => new NextRequest(url)

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllEnvs())

/** Everything the local demo needs, so only the deployment signal can refuse. */
function demoVariablesAllSet() {
  vi.stubEnv('APP_ENV', 'local')
  vi.stubEnv('GROW_LOCAL_MOCK', 'true')
  vi.stubEnv('MOBILE_DEV_AUTH_SECRET', 'a-secret-long-enough-to-pass')
  vi.stubEnv('MOBILE_DEV_AUTH_EMAIL', 'demo@example.com')
}

describe('the Grow demo mock is unreachable on a deployment', () => {
  it.each(['VERCEL', 'VERCEL_ENV', 'NEXT_PUBLIC_VERCEL_ENV'])('404s when %s marks a deployment', async (signal) => {
    demoVariablesAllSet()
    vi.stubEnv('NODE_ENV', 'development') // the friendliest case for the mock
    vi.stubEnv(signal, '1')

    const pay = await import('@/app/api/dev/grow-mock/pay/route')
    const callback = await import('@/app/api/dev/grow-mock/callback/route')
    expect((await pay.GET(req('https://preview.example.com/api/dev/grow-mock/pay?process=1'))).status).toBe(404)
    expect((await callback.POST(req('https://preview.example.com/api/dev/grow-mock/callback'))).status).toBe(404)
  })

  it('404s in production even with no Vercel signal at all', async () => {
    demoVariablesAllSet()
    vi.stubEnv('NODE_ENV', 'production')
    const pay = await import('@/app/api/dev/grow-mock/pay/route')
    expect((await pay.GET(req('https://example.com/api/dev/grow-mock/pay?process=1'))).status).toBe(404)
  })
})

describe('the email preview cannot send or render on a deployment', () => {
  it('404s both handlers when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const route = await import('@/app/api/dev/email-automation-preview/route')
    const post = new NextRequest('https://example.com/api/dev/email-automation-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ automation: 'welcome' }),
    })
    expect((await route.POST(post)).status).toBe(404)
    expect((await route.GET(req('https://example.com/api/dev/email-automation-preview?automation=welcome'))).status).toBe(404)
  })

  it('404s the renderer on a preview deployment even when NODE_ENV is not production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_ENV', 'preview')
    const route = await import('@/app/api/dev/email-automation-preview/route')
    expect((await route.GET(req('https://preview.example.com/api/dev/email-automation-preview?automation=welcome'))).status).toBe(404)
  })
})

describe('the passwordless dev sign-in does not exist in production', () => {
  it('404s with the secret and account both configured', async () => {
    demoVariablesAllSet()
    vi.stubEnv('NODE_ENV', 'production')
    const route = await import('@/app/api/mobile/v1/auth/dev/route')
    const post = new Request('https://example.com/api/mobile/v1/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-auth-secret': 'a-secret-long-enough-to-pass' },
      body: JSON.stringify({}),
    })
    expect((await route.POST(post)).status).toBe(404)
  })
})
