import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signBody, verifyIntegrationRequest } from '@/lib/weddingRsvp/integrationAuth'

/** Server-to-server HMAC: who may call /api/internal/wedding/*. */

const SECRET = 'x'.repeat(40)
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0)
const ts = Math.floor(NOW / 1000)
const body = JSON.stringify({ invitationId: 'abc' })

describe('verifyIntegrationRequest', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.WEDDING_INTEGRATION_SECRET
    process.env.WEDDING_INTEGRATION_SECRET = SECRET
  })
  afterEach(() => {
    process.env.WEDDING_INTEGRATION_SECRET = saved
  })

  it('accepts a correctly signed, fresh request and returns the parsed body', () => {
    expect(verifyIntegrationRequest(body, String(ts), signBody(SECRET, ts, body), NOW)).toEqual({ ok: true, body: { invitationId: 'abc' } })
  })

  it('rejects a wrong secret, a tampered body, missing headers', () => {
    expect(verifyIntegrationRequest(body, String(ts), signBody('y'.repeat(40), ts, body), NOW)).toMatchObject({ ok: false, status: 401 })
    expect(verifyIntegrationRequest(body + ' ', String(ts), signBody(SECRET, ts, body), NOW)).toMatchObject({ ok: false, status: 401 })
    expect(verifyIntegrationRequest(body, null, signBody(SECRET, ts, body), NOW)).toMatchObject({ ok: false, status: 401 })
    expect(verifyIntegrationRequest(body, String(ts), null, NOW)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a replay outside the ±5 minute window (the timestamp is inside the MAC)', () => {
    const old = ts - 301
    expect(verifyIntegrationRequest(body, String(old), signBody(SECRET, old, body), NOW)).toMatchObject({ ok: false, status: 401 })
    // re-stamping an old signature with a fresh timestamp does not verify
    expect(verifyIntegrationRequest(body, String(ts), signBody(SECRET, old, body), NOW)).toMatchObject({ ok: false, status: 401 })
  })

  it('is OFF (503) when no secret is configured, or the secret is too short', () => {
    process.env.WEDDING_INTEGRATION_SECRET = ''
    expect(verifyIntegrationRequest(body, String(ts), signBody(SECRET, ts, body), NOW)).toMatchObject({ ok: false, status: 503 })
    process.env.WEDDING_INTEGRATION_SECRET = 'short'
    expect(verifyIntegrationRequest(body, String(ts), signBody('short', ts, body), NOW)).toMatchObject({ ok: false, status: 503 })
  })
})
