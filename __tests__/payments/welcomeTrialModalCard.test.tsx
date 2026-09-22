// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CARD_TRIAL_CONSENT_LABEL, CARD_TRIAL_CONSENT_LINK_TEXT, CARD_STORAGE_CONSENT_LABEL } from '@/lib/payments/cardTrial/terms'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/actions/paymentMethod', () => ({ startCardSetup: vi.fn(), getCardSetupStatus: vi.fn() }))
vi.mock('@/actions/trial', () => ({
  startTrial: vi.fn(async () => ({ ok: true, started: true })),
  trackTrialStartClicked: vi.fn(async () => {}),
  trackTrialStartFailed: vi.fn(async () => {}),
  trackWelcomeModalSeen: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/facebook/pixelEvents', () => ({ trackStartTrial: vi.fn() }))
vi.mock('@/components/trial/ActivationCelebrationContext', () => ({ useActivationCelebration: () => ({ markActivated: vi.fn() }) }))

import WelcomeTrialModal from '@/components/trial/WelcomeTrialModal'
import CardTrialSetupForm from '@/components/trial/CardTrialSetupForm'
import { startCardSetup } from '@/actions/paymentMethod'
import { startTrial } from '@/actions/trial'

const cardSetup = { defaultFullName: 'ישראל ישראלי', canManageBilling: true, stage: 'setup' as const }

beforeEach(() => {
  vi.mocked(startCardSetup).mockReset()
  vi.mocked(startCardSetup).mockResolvedValue({ ok: true, url: 'https://sandbox.meshulam.co.il/far?l=x' })
  vi.mocked(startTrial).mockClear()
})

describe('welcome modal — card-required variant', () => {
  it('asks for the cardholder and never starts a trial by itself', async () => {
    render(<WelcomeTrialModal cardSetup={cardSetup} />)
    expect(await screen.findByText('הוספת כרטיס והפעלת הניסיון')).toBeTruthy()
    expect(screen.getByLabelText(/שם מלא/)).toBeTruthy()
    expect(screen.getByLabelText(/טלפון נייד/)).toBeTruthy()
    expect(screen.queryByText('הפעל את ה-Pro שלי')).toBeNull()
    expect(startTrial).not.toHaveBeenCalled()
  })

  it('states 7 days from activation, the monthly price, that nothing is charged today, and the cancel path', () => {
    render(<WelcomeTrialModal cardSetup={cardSetup} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('7 ימים ללא עלות מרגע ההפעלה')
    expect(text).toContain('₪89 לחודש')
    expect(text).toContain('היום לא יבוצע חיוב')
    expect(text).toContain('לבטל בכל רגע לפני החיוב הראשון')
    expect(text).not.toContain('ללא כרטיס אשראי')
  })

  it('separates subscription consent from Grow card-storage consent, and links the terms', () => {
    render(<WelcomeTrialModal cardSetup={cardSetup} />)

    // The sentence the customer agrees to, rendered exactly as it is recorded.
    expect(document.body.textContent).toContain(CARD_TRIAL_CONSENT_LABEL)
    expect(document.body.textContent).toContain(CARD_STORAGE_CONSENT_LABEL)

    // "תנאי השימוש והתקנון" inside that sentence is a link to the real terms.
    const inline = screen.getByRole('link', { name: CARD_TRIAL_CONSENT_LINK_TEXT })
    expect(inline.getAttribute('href')).toBe('/terms')
    expect(inline.getAttribute('target')).toBe('_blank')

    expect(document.body.textContent).toContain('בעמוד המאובטח של Grow')
  })

  /**
   * The link sits inside the checkbox's <label>. Per the HTML spec a label runs
   * no activation behaviour for events targeted at an interactive descendant,
   * so opening the terms must not silently tick the consent — which would be
   * consent the customer never gave.
   */
  it('opening the terms link does not tick the consent', () => {
    render(<WelcomeTrialModal cardSetup={cardSetup} />)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.every((b) => !b.checked)).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: CARD_TRIAL_CONSENT_LINK_TEXT }))
    expect(boxes.every((b) => !b.checked)).toBe(true)
  })

  it('the consent checkboxes still toggle when the customer clicks them', () => {
    render(<WelcomeTrialModal cardSetup={cardSetup} />)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    fireEvent.click(boxes[0])
    expect(boxes[0].checked).toBe(true)
    fireEvent.click(boxes[0])
    expect(boxes[0].checked).toBe(false)
  })

  it('refuses to open the payment page without consent', async () => {
    const onRedirect = vi.fn()
    vi.mocked(startCardSetup).mockResolvedValue({ error: 'terms_required' })
    render(<CardTrialSetupForm purpose='trial_start' submitLabel='המשך' onRedirect={onRedirect} />)
    fireEvent.click(screen.getByText('המשך'))
    expect(await screen.findByText('יש לאשר את תנאי המנוי כדי להמשיך')).toBeTruthy()
    expect(onRedirect).not.toHaveBeenCalled()
  })

  it('sends the holder and the consent, then leaves for Grow', async () => {
    const onRedirect = vi.fn()
    render(<CardTrialSetupForm purpose='trial_start' defaultFullName='ישראל ישראלי' submitLabel='המשך' onRedirect={onRedirect} />)
    fireEvent.change(screen.getByLabelText(/טלפון נייד/), { target: { value: '0501234567' } })
    // Two separate consents: the subscription, and storing the card.
    screen.getAllByRole('checkbox').forEach((box) => fireEvent.click(box))
    fireEvent.click(screen.getByText('המשך'))
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://sandbox.meshulam.co.il/far?l=x'))
    expect(startCardSetup).toHaveBeenCalledWith({
      purpose: 'trial_start',
      fullName: 'ישראל ישראלי',
      phone: '0501234567',
      acceptedTerms: true,
      acceptedCardStorage: true,
    })
  })

  it('shows the field message for an invalid holder and does not redirect', async () => {
    const onRedirect = vi.fn()
    vi.mocked(startCardSetup).mockResolvedValue({ error: 'invalid_holder', field: 'phone', message: 'יש להזין מספר נייד ישראלי תקין, לדוגמה 0501234567' })
    render(<CardTrialSetupForm purpose='trial_start' submitLabel='המשך' onRedirect={onRedirect} />)
    fireEvent.click(screen.getByText('המשך'))
    expect(await screen.findByText('יש להזין מספר נייד ישראלי תקין, לדוגמה 0501234567')).toBeTruthy()
    expect(onRedirect).not.toHaveBeenCalled()
  })

  it('cannot open two setups at once: the action is disabled while one is opening', async () => {
    let release: (v: { ok: true; url: string }) => void = () => {}
    vi.mocked(startCardSetup).mockReturnValue(new Promise((r) => (release = r)) as never)
    render(<CardTrialSetupForm purpose='trial_start' submitLabel='המשך' onRedirect={vi.fn()} />)
    fireEvent.click(screen.getByText('המשך'))
    await waitFor(() => expect(screen.getByText('רק רגע...')).toBeTruthy())
    fireEvent.click(screen.getByText('רק רגע...'))
    expect(startCardSetup).toHaveBeenCalledTimes(1)
    release({ ok: true, url: 'https://sandbox.meshulam.co.il/far?l=x' })
  })

  it('tells a non-admin who can do this', () => {
    render(<WelcomeTrialModal cardSetup={{ ...cardSetup, canManageBilling: false }} />)
    expect(screen.getByText('רק מנהל החשבון יכול להפעיל את תקופת הניסיון.')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})

describe('welcome modal — click-to-start (no card) is unchanged', () => {
  it('keeps the original CTA and copy', async () => {
    render(<WelcomeTrialModal />)
    expect(await screen.findByText('הפעל את ה-Pro שלי')).toBeTruthy()
    expect(document.body.textContent).toContain('ללא כרטיס אשראי')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    fireEvent.click(screen.getByText('הפעל את ה-Pro שלי'))
    await waitFor(() => expect(startTrial).toHaveBeenCalled())
    expect(startCardSetup).not.toHaveBeenCalled()
  })
})
