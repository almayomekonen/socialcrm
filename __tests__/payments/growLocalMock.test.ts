import { describe, it, expect, vi, afterEach } from 'vitest'
import { isGrowLocalMockEnabled, localMockOrigin, localMockCreateTokenOnlyProcess, localMockVerifyTokenSave } from '@/lib/payments/grow/localMock'

afterEach(() => vi.unstubAllEnvs())

const enable = () => {
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('APP_ENV', 'local')
  vi.stubEnv('GROW_LOCAL_MOCK', 'true')
}

describe('the local Grow demo mock fails closed', () => {
  it('is off unless all three conditions hold', () => {
    enable()
    expect(isGrowLocalMockEnabled()).toBe(true)
    for (const [k, v] of [['NODE_ENV', 'production'], ['APP_ENV', 'staging'], ['GROW_LOCAL_MOCK', ''], ['VERCEL', '1'], ['VERCEL_ENV', 'preview'], ['NEXT_PUBLIC_VERCEL_ENV', 'production']] as const) {
      enable()
      vi.stubEnv(k, v)
      expect(isGrowLocalMockEnabled()).toBe(false)
    }
  })

  it('refuses to produce a payment process while disabled', async () => {
    vi.stubEnv('APP_ENV', 'production')
    await expect(
      localMockCreateTokenOnlyProcess({ holder: { fullName: 'a b', phone: '0501234567', email: null }, reference: 'r', description: 'd', successUrl: 's', cancelUrl: 'c', notifyUrl: '' }),
    ).rejects.toThrow('grow.local_mock.disabled')
    expect(await localMockVerifyTokenSave({ cardToken: 'x' })).toEqual({ kind: 'unavailable', reason: 'provider_evidence_missing' })
  })

  it('only ever points at localhost', () => {
    enable()
    vi.stubEnv('GROW_LOCAL_MOCK_ORIGIN', 'https://getsocialcrm.com')
    expect(localMockOrigin()).toBe('http://localhost:3002')
    vi.stubEnv('GROW_LOCAL_MOCK_ORIGIN', 'http://localhost:4000')
    expect(localMockOrigin()).toBe('http://localhost:4000')
  })

  it('verifies the demo card and refuses the demo refusal token', async () => {
    enable()
    expect(await localMockVerifyTokenSave({ cardToken: 'mock-card-token' })).toMatchObject({ kind: 'verified' })
    expect(await localMockVerifyTokenSave({ cardToken: 'refused-card-token' })).toEqual({ kind: 'refused', reason: 'unexpected_status' })
  })
})
