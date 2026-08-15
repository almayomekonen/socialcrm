import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeAppSubscribed, probePhoneStatus } from '@/lib/whatsapp/registration'

const originalFetch = global.fetch

function jsonRes(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body }
}

afterEach(() => {
  global.fetch = originalFetch
})

describe('WhatsApp health probes', () => {
  it('HTTP 401 → token', async () => {
    global.fetch = vi.fn(async () => jsonRes(false, 401, { error: { code: 190 } })) as unknown as typeof fetch
    expect(await probePhoneStatus('P1', 't')).toMatchObject({ ok: false, kind: 'token' })
    expect(await probeAppSubscribed('W1', 't')).toMatchObject({ ok: false, kind: 'token' })
  })

  it('Graph 190 on HTTP 400 → token', async () => {
    global.fetch = vi.fn(async () => jsonRes(false, 400, { error: { code: 190 } })) as unknown as typeof fetch
    expect(await probePhoneStatus('P1', 't')).toMatchObject({ ok: false, kind: 'token' })
  })

  it('CONNECTED phone → ok', async () => {
    global.fetch = vi.fn(async () => jsonRes(true, 200, { status: 'CONNECTED' })) as unknown as typeof fetch
    expect(await probePhoneStatus('P1', 't')).toEqual({ ok: true, status: 'CONNECTED' })
  })

  it('empty subscribed_apps → ok, not subscribed', async () => {
    global.fetch = vi.fn(async () => jsonRes(true, 200, { data: [] })) as unknown as typeof fetch
    expect(await probeAppSubscribed('W1', 't')).toEqual({ ok: true, subscribed: false })
  })
})
