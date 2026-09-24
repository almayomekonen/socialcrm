import { describe, it, expect, vi, beforeEach } from 'vitest'

// Defined inside the factory: vi.mock is hoisted above every top-level binding.
vi.mock('@/lib/requireUser', () => ({
  AuthError: class AuthError extends Error {},
  requireUser: vi.fn(async () => ({ id: 1, agencyId: 42, email: 'o@example.com' })),
}))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(async () => {}) }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/payments/upgrade/route'
import { requireUser, AuthError } from '@/lib/requireUser'
import { track } from '@/lib/analytics/track'

/**
 * /api/payments/upgrade used to build a Grow Payment Link and redirect to it.
 * Payment Links are gone. The URL survives only because it is bookmarked and
 * sits in already-sent mail, and it must now lead to the saved-card journey —
 * never to a payment provider, and never to a checkout for an amount the
 * customer did not choose.
 */
const req = (qs = '?source=test') =>
  new NextRequest(`https://app.example.com/api/payments/upgrade${qs}`, { headers: { host: 'app.example.com' } })

beforeEach(() => {
  vi.mocked(track).mockClear()
  vi.mocked(requireUser).mockReset()
  vi.mocked(requireUser).mockResolvedValue({ id: 1, agencyId: 42, email: 'o@example.com' } as never)
})

describe('GET /api/payments/upgrade — retired', () => {
  it('sends an authenticated customer to the billing screen', async () => {
    const res = await GET(req())
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/settings/update_payment')
  })

  it('never forwards to a payment provider, whatever the bookmark asks for', async () => {
    for (const qs of ['?period=annual&source=old_email', '?period=monthly', '']) {
      const location = new URL((await GET(req(qs))).headers.get('location')!)
      expect(location.host).toBe('app.example.com')
      expect(location.pathname).toBe('/settings/update_payment')
      // No amount, period or provider identifier is carried forward.
      expect(location.search).toBe('')
    }
  })

  it('records the click as monthly, because that is the only thing sold', async () => {
    await GET(req('?period=annual&source=old_email'))
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ props: { source: 'old_email', period: 'monthly' } }))
  })

  it('sends an anonymous visitor to log in, and back to billing afterwards', async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError('no_session'))
    const res = await GET(req())
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth')
    expect(location.searchParams.get('next')).toBe('/settings/update_payment')
  })
})
