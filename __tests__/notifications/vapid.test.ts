import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { getVapidConfig, isVapidConfigured } from '@/lib/notifications/vapid'
import { parsePushSubscriptionBody, truncateUserAgent } from '@/lib/notifications/pushSubscriptionSchema'

describe('getVapidConfig — fail-soft, explicit state', () => {
  const keys = [
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_SUBJECT',
    'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  ] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('reports not_configured with every missing name when env is empty — never throws', () => {
    const cfg = getVapidConfig()
    expect(cfg.status).toBe('not_configured')
    expect(cfg.missing).toEqual(expect.arrayContaining([...keys]))
    expect(cfg.publicKey).toBeNull()
    expect(isVapidConfigured()).toBe(false)
  })

  it('reports configured only when all four vars agree', () => {
    process.env.VAPID_PUBLIC_KEY = 'BPub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com'
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'BPub'
    const cfg = getVapidConfig()
    expect(cfg.status).toBe('configured')
    expect(cfg.missing).toEqual([])
    expect(cfg.publicKey).toBe('BPub')
    expect(cfg.subject).toBe('mailto:ops@example.com')
    expect(isVapidConfigured()).toBe(true)
  })

  it('mismatch between server and client public keys is not_configured', () => {
    process.env.VAPID_PUBLIC_KEY = 'server'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com'
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'client'
    const cfg = getVapidConfig()
    expect(cfg.status).toBe('not_configured')
    expect(cfg.missing).toContain('VAPID_PUBLIC_KEY_MISMATCH')
  })
})

describe('parsePushSubscriptionBody', () => {
  const valid = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'p256', auth: 'authkey' },
  }

  it('accepts a well-formed subscription and returns only stored fields', () => {
    const parsed = parsePushSubscriptionBody(valid)
    expect(parsed).toEqual({ ok: true, value: valid })
  })

  it('ignores arbitrary extra fields — they never appear in the value', () => {
    const parsed = parsePushSubscriptionBody({
      ...valid,
      phone: '050-0000000',
      email: 'x@y.com',
      idNum: '123',
      userId: 999,
      agencyId: 999,
      metadata: { evil: true },
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual(valid)
    expect(parsed.value).not.toHaveProperty('phone')
    expect(parsed.value).not.toHaveProperty('userId')
  })

  it('rejects malformed endpoint (non-https)', () => {
    expect(parsePushSubscriptionBody({ ...valid, endpoint: 'http://insecure.example/x' }).ok).toBe(false)
    expect(parsePushSubscriptionBody({ ...valid, endpoint: 'not-a-url' }).ok).toBe(false)
  })

  it('rejects missing keys', () => {
    expect(parsePushSubscriptionBody({ endpoint: valid.endpoint }).ok).toBe(false)
    expect(parsePushSubscriptionBody({ endpoint: valid.endpoint, keys: { p256dh: 'x' } }).ok).toBe(false)
    expect(parsePushSubscriptionBody(null).ok).toBe(false)
    expect(parsePushSubscriptionBody('nope').ok).toBe(false)
  })

  it('truncateUserAgent never invents a value from the body', () => {
    expect(truncateUserAgent(undefined)).toBeNull()
    expect(truncateUserAgent('')).toBeNull()
    expect(truncateUserAgent('Mozilla/5.0')).toBe('Mozilla/5.0')
    expect(truncateUserAgent('x'.repeat(600))!.length).toBe(512)
  })
})
