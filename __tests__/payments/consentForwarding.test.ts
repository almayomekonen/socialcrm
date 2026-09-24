import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/requireUser', () => ({
  AuthError: class AuthError extends Error {},
  requireAgencyUser: vi.fn(async () => ({ id: 1, agencyId: 42, email: 'o@example.com', role: 'ADMIN' })),
}))
vi.mock('@/lib/payments/cardTrial/startCardSetup', () => ({ startCardSetupForUser: vi.fn(async () => ({ ok: true, url: 'https://sandbox.meshulam.co.il/far?l=x' })) }))

import { startCardSetup } from '@/actions/paymentMethod'
import { startCardSetupForUser } from '@/lib/payments/cardTrial/startCardSetup'

/**
 * The bug this file exists for: the action wrapper rebuilds its input as an
 * allow-list, and when card-storage consent was added the new field was not
 * added here. Both boxes were ticked, the server saw `undefined`, and the form
 * said the customer had not consented. TypeScript could not see it — the
 * property is simply absent and every other one is optional — so the guard has
 * to be a test.
 */
const sent = () => vi.mocked(startCardSetupForUser).mock.calls.at(-1)?.[1]

beforeEach(() => vi.mocked(startCardSetupForUser).mockClear())

describe('the action wrapper forwards every consent it is given', () => {
  it('passes BOTH consents through to the domain', async () => {
    await startCardSetup({ purpose: 'trial_start', fullName: 'John Smith', phone: '0501234567', acceptedTerms: true, acceptedCardStorage: true })
    expect(sent()).toMatchObject({ acceptedTerms: true, acceptedCardStorage: true })
  })

  it('does not invent consent that was not given', async () => {
    await startCardSetup({ purpose: 'trial_start', fullName: 'John Smith', phone: '0501234567', acceptedTerms: true })
    expect(sent()).toMatchObject({ acceptedTerms: true, acceptedCardStorage: false })

    await startCardSetup({ purpose: 'trial_start', acceptedTerms: true, acceptedCardStorage: 'yes' as unknown as boolean })
    expect(sent()).toMatchObject({ acceptedCardStorage: false })
  })

  it('forwards it for a card replacement too, which is also a new card on file', async () => {
    await startCardSetup({ purpose: 'card_update', acceptedCardStorage: true })
    expect(sent()).toMatchObject({ purpose: 'card_update', acceptedCardStorage: true })
  })

  it('every field the domain reads is forwarded — a new one must be added here', () => {
    const src = require('fs').readFileSync('actions/paymentMethod.ts', 'utf8')
    for (const field of ['purpose', 'fullName', 'phone', 'acceptedTerms', 'acceptedCardStorage']) {
      expect(src, field).toContain(field)
    }
  })
})
