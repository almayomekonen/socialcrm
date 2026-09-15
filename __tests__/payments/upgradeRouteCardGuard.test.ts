import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/requireUser', () => ({
  AuthError: class AuthError extends Error {},
  requireUser: vi.fn(async () => ({ id: 1, agencyId: 42, email: 'o@example.com' })),
}))
vi.mock('@/db/payments/paymentMethods', () => ({ hasConfirmedPaymentMethod: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(async () => {}) }))
vi.mock('@/config/db', () => ({ db: vi.fn(() => ({ insert: vi.fn(async () => [1]) })) }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/payments/upgrade/route'
import { hasConfirmedPaymentMethod } from '@/db/payments/paymentMethods'
import { db } from '@/config/db'

const req = () => new NextRequest('https://app.example.com/api/payments/upgrade?source=test', { headers: { host: 'app.example.com' } })

beforeEach(() => {
  vi.mocked(hasConfirmedPaymentMethod).mockReset()
  vi.mocked(db).mockClear()
})

describe('GET /api/payments/upgrade — card-token billed agencies', () => {
  it('sends a card-token billed agency to billing settings, never to a Payment Link', async () => {
    vi.mocked(hasConfirmedPaymentMethod).mockResolvedValue(true)
    const res = await GET(req())
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/settings/update_payment')
    expect(hasConfirmedPaymentMethod).toHaveBeenCalledWith(42)
    expect(db).not.toHaveBeenCalled()
  })
})
