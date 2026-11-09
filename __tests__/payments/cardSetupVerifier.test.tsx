// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'

vi.mock('@/actions/paymentMethod', () => ({ getCardSetupStatus: vi.fn() }))

import CardSetupVerifier from '@/components/billing/CardSetupVerifier'
import type { CardSetupState } from '@/lib/payments/cardTrial/setupStatus'

const verifying: CardSetupState = { state: 'verifying', callbackReceived: false, firstChargeAt: null, chargesEnabled: false, sandbox: false }
const confirmed = (firstChargeAt: string, over: Partial<CardSetupState> = {}): CardSetupState => ({
  state: 'confirmed',
  callbackReceived: true,
  firstChargeAt,
  chargesEnabled: false,
  sandbox: false,
  ...over,
})

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

describe('the return page never announces what the server has not confirmed', () => {
  it('says it is verifying, and that nothing is charged, while the answer is pending', async () => {
    render(<CardSetupVerifier purpose='card_trial' poll={vi.fn(async () => verifying)} />)
    expect(await screen.findByText(/מאמתים מול חברת הסליקה/)).toBeTruthy()
    expect(document.body.textContent).toContain('לא מבוצע חיוב עבור המנוי')
    expect(document.body.textContent).not.toContain('תקופת הניסיון הופעלה')
  })

  it('names a real charge only when charging can actually happen', async () => {
    render(<CardSetupVerifier purpose='card_trial' poll={vi.fn(async () => confirmed('2026-09-23T09:00:00.000Z', { chargesEnabled: true }))} />)
    expect(await screen.findByText('תקופת הניסיון הופעלה')).toBeTruthy()
    expect(document.body.textContent).toContain('23/09/2026')
    expect(document.body.textContent).toContain('₪89')
  })

  it('does NOT promise a charge on that date while charging is disabled', async () => {
    render(<CardSetupVerifier purpose='card_trial' poll={vi.fn(async () => confirmed('2026-09-23T09:00:00.000Z'))} />)
    expect(await screen.findByText('תקופת הניסיון הופעלה')).toBeTruthy()
    expect(document.body.textContent).toContain('23/09/2026')
    // The date is when the TRIAL ends, not when money moves.
    expect(document.body.textContent).toContain('חיוב אוטומטי אינו פעיל')
    expect(document.body.textContent).not.toContain('₪89')
  })

  it('says plainly when the result is a sandbox test', async () => {
    render(<CardSetupVerifier purpose='card_trial' poll={vi.fn(async () => confirmed('2026-09-23T09:00:00.000Z', { sandbox: true }))} />)
    expect(await screen.findByText(/Sandbox/)).toBeTruthy()
    expect(document.body.textContent).toContain('לא בוצעה עסקה אמיתית')
  })

  it('stops polling once the outcome is known', async () => {
    const poll = vi.fn(async () => confirmed('2026-09-23T09:00:00.000Z'))
    render(<CardSetupVerifier purpose='reactivate' poll={poll} />)
    await screen.findByText('המנוי חודש')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('offers a real next step instead of an endless spinner when verification does not answer', async () => {
    const poll = vi.fn(async () => ({ ...verifying, callbackReceived: true }))
    render(<CardSetupVerifier purpose='card_trial' poll={poll} />)
    await vi.advanceTimersByTimeAsync(31_000)
    expect(await screen.findByText('האישור עדיין בבדיקה')).toBeTruthy()
    expect(document.body.textContent).toContain('עדיין לא בוצע חיוב')
    expect(screen.getByText('לעמוד המנוי')).toBeTruthy()
    expect(screen.getByText('חזרה למערכת')).toBeTruthy()
    const callsAtTimeout = poll.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(poll).toHaveBeenCalledTimes(callsAtTimeout)
  })

  it('a failed setup says no charge was made and points at the retry', async () => {
    render(<CardSetupVerifier purpose='card_trial' poll={vi.fn(async () => ({ state: 'failed' as const, callbackReceived: true, firstChargeAt: null, chargesEnabled: false, sandbox: false }))} />)
    expect(await screen.findByText('לא הצלחנו לאמת את הכרטיס')).toBeTruthy()
    expect(document.body.textContent).toContain('לא בוצע חיוב')
  })

  it('is the only thing the success page can render, and a stale Payment-Link return goes to billing', () => {
    const page = readFileSync('app/(he)/billing/success/page.tsx', 'utf8')
    expect(page).toContain('CardSetupVerifier')
    // The Payment-Link entitlement verifier is gone with Payment Links.
    expect(page).not.toContain('BillingActivationVerifier')
    // A return with no recognised source is a stale bookmark: send it to the
    // billing screen rather than polling for a setup nobody started.
    expect(page).toContain("redirect('/settings/update_payment')")
    const verifier = readFileSync('components/billing/CardSetupVerifier.tsx', 'utf8')
    expect(verifier).toContain('const POLL_INTERVAL_MS = 2_000')
    expect(verifier).toContain('const MAX_WAIT_MS = 30_000')
  })

  it('a card added from the credit purchase page returns there once the server confirms, and only then', async () => {
    const navigate = vi.fn()
    const { unmount } = render(<CardSetupVerifier purpose='card_update' returnTo='/billing/credits' navigate={navigate} poll={vi.fn(async () => verifying)} />)
    await screen.findByText(/מאמתים/)
    expect(navigate).not.toHaveBeenCalled()
    unmount()
    render(<CardSetupVerifier purpose='card_update' returnTo='/billing/credits' navigate={navigate} poll={vi.fn(async () => confirmed('2026-12-01T00:00:00Z'))} />)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/billing/credits'))
  })
})
