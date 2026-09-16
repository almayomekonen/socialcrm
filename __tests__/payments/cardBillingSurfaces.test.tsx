// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('@/actions/subscription', () => ({ cancelRenewal: vi.fn(), resumeRenewal: vi.fn() }))
vi.mock('@/actions/paymentMethod', () => ({ startCardSetup: vi.fn(), getCardSetupStatus: vi.fn() }))
vi.mock('@/actions/trial', () => ({ trackTrialStartClicked: vi.fn(async () => {}), trackTrialStartFailed: vi.fn(async () => {}) }))

import CardBillingControls from '@/components/trial/CardBillingControls'
import CardOnFileSummary from '@/components/trial/CardOnFileSummary'
import TrialStatusCard from '@/components/trial/TrialStatusCard'
import TrialExpiredScreen from '@/components/trial/TrialExpiredScreen'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'
import { startCardSetup } from '@/actions/paymentMethod'
import type { CardTrialView } from '@/lib/payments/cardTrial/cardTrialView'

const view = (over: Partial<CardTrialView> = {}): CardTrialView => ({
  hasActiveCard: true,
  setup: 'confirmed',
  payment: 'none',
  card: { suffix: '3253', brand: 'Visa' },
  cancelAtPeriodEnd: false,
  firstChargeAt: new Date('2026-09-23T09:00:00.000Z'),
  cardBilled: true,
  ...over,
})

beforeEach(() => {
  vi.mocked(cancelRenewal).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(resumeRenewal).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(startCardSetup).mockReset().mockResolvedValue({ ok: true, url: 'https://sandbox.meshulam.co.il/far?l=x' })
  Object.defineProperty(window, 'location', { value: { assign: vi.fn(), reload: vi.fn(), href: '' }, writable: true })
})

describe('card on file', () => {
  it('shows the stored card and the next charge with its date', () => {
    render(<CardOnFileSummary view={view()} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Visa')
    expect(text).toContain('3253')
    expect(text).toContain('₪89')
    expect(text).toContain('23/09/2026')
  })

  it('a cancelled subscription promises no further charge and offers renewal', () => {
    render(<CardOnFileSummary view={view({ cancelAtPeriodEnd: true })} />)
    expect(document.body.textContent).toContain('לא יבוצע חיוב נוסף')
    expect(screen.getByText('חידוש המנוי')).toBeTruthy()
    expect(screen.queryByText('ביטול לפני החיוב')).toBeNull()
  })

  it.each([
    ['unknown', 'מוודאים מול חברת הסליקה'],
    ['declined', 'לא אושר'],
    ['in_progress', 'נשלח לעיבוד'],
  ] as const)('states the %s payment phase honestly', (payment, copy) => {
    render(<CardOnFileSummary view={view({ payment })} />)
    expect(document.body.textContent).toContain(copy)
  })
})

describe('cancellation copy', () => {
  it('promises no charge only when nothing was dispatched', async () => {
    render(<CardBillingControls cancelAtPeriodEnd={false} />)
    fireEvent.click(screen.getByText('ביטול לפני החיוב'))
    expect(await screen.findByText(/לא יבוצע חיוב של ₪89/)).toBeTruthy()
  })

  it('never claims "no charge" once one is with Grow, and promises no refund', async () => {
    render(<CardBillingControls cancelAtPeriodEnd={false} chargeInProgress />)
    expect(document.body.textContent).toContain('החיוב כבר נשלח לעיבוד')
    fireEvent.click(screen.getByText('ביטול לפני החיוב'))
    const dialog = await screen.findByText(/חיוב אחד כבר נשלח לעיבוד/)
    expect(dialog).toBeTruthy()
    expect(document.body.textContent).not.toContain('לא יבוצע חיוב של')
    expect(document.body.textContent).not.toMatch(/החזר|זיכוי/)
  })

  it('cancels only after the explicit confirmation', async () => {
    render(<CardBillingControls cancelAtPeriodEnd={false} />)
    fireEvent.click(screen.getByText('ביטול לפני החיוב'))
    expect(cancelRenewal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('ביטול המנוי'))
    await waitFor(() => expect(cancelRenewal).toHaveBeenCalledTimes(1))
  })

  it('reports an in-flight charge returned by the server', async () => {
    vi.mocked(cancelRenewal).mockResolvedValue({ ok: true, chargeInProgress: true })
    render(<CardBillingControls cancelAtPeriodEnd={false} />)
    fireEvent.click(screen.getByText('ביטול לפני החיוב'))
    fireEvent.click(screen.getByText('ביטול המנוי'))
    await waitFor(() => expect(cancelRenewal).toHaveBeenCalled())
  })

  it('sends an expired card subscription to reactivation instead of resuming silently', async () => {
    vi.mocked(resumeRenewal).mockResolvedValue({ error: 'reactivation_required' })
    render(<CardBillingControls cancelAtPeriodEnd />)
    fireEvent.click(screen.getByText('חידוש המנוי'))
    expect(await screen.findByText(/יש לאשר אמצעי תשלום מחדש/)).toBeTruthy()
  })

  it('replaces a card without reactivating anything', async () => {
    const onReplaceRedirect = vi.fn()
    render(<CardBillingControls cancelAtPeriodEnd={false} onReplaceRedirect={onReplaceRedirect} />)
    fireEvent.click(screen.getByText('החלפת כרטיס'))
    await waitFor(() => expect(startCardSetup).toHaveBeenCalledWith({ purpose: 'card_update' }))
    expect(onReplaceRedirect).toHaveBeenCalledWith('https://sandbox.meshulam.co.il/far?l=x')
    expect(resumeRenewal).not.toHaveBeenCalled()
  })
})

describe('trial status card', () => {
  it('a card trial converts automatically instead of suspending access', () => {
    render(<TrialStatusCard startedAt={new Date('2026-09-16T09:00:00Z')} endsAt={new Date('2026-09-23T09:00:00Z')} daysRemaining={5} cardBilled />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('23/09/2026')
    expect(text).toContain('₪89')
    expect(text).not.toContain('הגישה תושהה')
  })

  it('a no-card trial keeps the original upgrade copy', () => {
    render(<TrialStatusCard startedAt={new Date('2026-09-16T09:00:00Z')} endsAt={new Date('2026-09-23T09:00:00Z')} daysRemaining={5} />)
    expect(document.body.textContent).toContain('הגישה תושהה')
  })
})

describe('expired trial recovery', () => {
  it.each([
    ['declined', 'לא הצלחנו לחייב את הכרטיס ששמרת'],
    ['cancelled', 'ביטלת את המשך המנוי'],
    ['ended', 'כדי להמשיך, יש לאשר אמצעי תשלום'],
  ] as const)('explains the %s case and offers reactivation with consent', (reason, copy) => {
    render(<TrialExpiredScreen cardReactivation={{ reason }} />)
    expect(document.body.textContent).toContain(copy)
    expect(screen.getByText('עדכון אמצעי תשלום והמשך')).toBeTruthy()
    expect(screen.getByRole('checkbox')).toBeTruthy()
    expect(screen.queryByText('שדרג עכשיו')).toBeNull()
  })

  it('never advertises the annual plan in a monthly-only card flow', () => {
    render(<TrialExpiredScreen cardReactivation={{ reason: 'ended' }} />)
    expect(document.body.textContent).not.toContain('לשנה')
    cleanup()
    render(<TrialExpiredScreen />)
    expect(document.body.textContent).toContain('לשנה')
  })

  it('a no-card agency still gets the Payment-Link upgrade', () => {
    render(<TrialExpiredScreen />)
    expect(screen.getByText('שדרג עכשיו')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
