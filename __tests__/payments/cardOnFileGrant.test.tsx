// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import CardOnFileSummary from '@/components/trial/CardOnFileSummary'
import type { CardTrialView } from '@/lib/payments/cardTrial/cardTrialView'

/**
 * A STORED CARD IS NOT A SUBSCRIPTION.
 *
 * Agency 103 holds an explicit Pro grant (planReason 'manual:owner-comp') and,
 * since 2026-09-26, a verified Mastercard on file. The summary read its
 * sentences off the subscription model and therefore told the owner that
 * monthly billing was active, that ₪89 would be taken on 22/09/2026, and that
 * they could cancel before it — while BOTH scheduling queries select that
 * agency zero times, and always will: trial conversion requires plan <> 'pro'
 * and renewal requires planReason LIKE 'grow:%'.
 *
 * The card is real, so it is shown and it can be replaced. Everything that
 * describes a schedule is not, so it goes.
 */

afterEach(cleanup)
vi.mock('@/actions/subscription', () => ({ cancelRenewal: async () => ({ ok: true }), resumeRenewal: async () => ({ ok: true }) }))
vi.mock('@/actions/paymentMethod', () => ({ startCardSetup: async () => ({ ok: true, url: '#' }) }))

const view = {
  cardBilled: true,
  card: { brand: 'Mastercard', suffix: '0675' },
  cancelAtPeriodEnd: false,
  firstChargeAt: new Date('2026-09-22T08:49:21.549Z'),
  payment: 'none',
} as unknown as CardTrialView

describe('card on file, under a grant', () => {
  it('names the card and promises no charge', () => {
    render(<CardOnFileSummary view={view} granted />)
    const text = document.body.textContent ?? ''

    expect(text).toContain('כרטיס שמור')
    expect(text).toContain('הכרטיס שמור לשימוש עתידי. לא נקבע חיוב.')
    expect(text).toContain('0675')

    // None of the schedule claims survive.
    expect(text).not.toContain('חיוב חודשי פעיל')
    expect(text).not.toContain('החיוב הבא')
    expect(text).not.toContain('ומדי חודש לאחר מכן')
  })

  it('keeps card replacement and drops the subscription actions', () => {
    render(<CardOnFileSummary view={view} granted />)
    expect(screen.getByRole('button', { name: 'החלפת כרטיס' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ביטול לפני החיוב' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'חידוש המנוי' })).toBeNull()
  })

  it('a real subscription is untouched — it still states the next charge and offers cancellation', () => {
    render(<CardOnFileSummary view={view} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('חיוב חודשי פעיל')
    expect(text).toContain('החיוב הבא')
    expect(screen.getByRole('button', { name: 'ביטול לפני החיוב' })).toBeTruthy()
  })
})
