// @vitest-environment jsdom
/**
 * The settings card's assistant consent: offered with the exact v3 text on an
 * active reminders-only row, sent with its version; withdrawable once granted;
 * and activation sends the version of the sentence it displayed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const actions = vi.hoisted(() => ({ start: vi.fn(), off: vi.fn(), grant: vi.fn(), withdraw: vi.fn() }))
vi.mock('@/actions/whatsappReminders', () => ({
  startWhatsappReminderActivation: actions.start,
  turnOffWhatsappReminders: actions.off,
  grantWhatsappAssistantConsent: actions.grant,
  withdrawWhatsappAssistantConsent: actions.withdraw,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import WhatsappReminderCard from '@/components/settings/whatsappReminders/WhatsappReminderCard'
import { OWNER_WA_ASSISTANT_CONSENT, OWNER_WA_CONSENT } from '@/lib/whatsapp/platform/consentText'

afterEach(() => {
  cleanup()
  for (const f of Object.values(actions)) f.mockReset()
})

const active = (assistant: 'not_offered' | 'consent_required' | 'granted') => ({
  state: 'active' as const,
  maskedPhone: '••••••72',
  assistant,
})

describe('assistant consent on the settings card', () => {
  it('not offered: the active card is unchanged (no checkbox)', () => {
    render(<WhatsappReminderCard initial={active('not_offered')} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'אישור שיחות עם העוזר' })).toBeNull()
  })

  it('consent required: shows the exact v3 text; the button stays disabled until ticked, then sends v3', async () => {
    actions.grant.mockResolvedValue({ ok: true })
    render(<WhatsappReminderCard initial={active('consent_required')} />)
    const box = screen.getByRole('checkbox', { name: OWNER_WA_ASSISTANT_CONSENT.text })
    const button = screen.getByRole('button', { name: 'אישור שיחות עם העוזר' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'צריך לאשר שיחות עם העוזר')
    fireEvent.click(box)
    fireEvent.click(button)
    await waitFor(() => expect(actions.grant).toHaveBeenCalledWith({ consent: true, consentVersion: 'v3' }))
    // Turning everything off stays available next to it.
    expect(screen.getByRole('button', { name: 'כיבוי תזכורות' })).toBeInTheDocument()
  })

  it('granted: says so and offers to stop the assistant only', async () => {
    actions.withdraw.mockResolvedValue({ ok: true })
    render(<WhatsappReminderCard initial={active('granted')} />)
    expect(screen.getByText(/השיחות עם העוזר פעילות/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ביטול השיחות עם העוזר' }))
    await waitFor(() => expect(actions.withdraw).toHaveBeenCalledTimes(1))
  })

  it('activation shows the sentence the server will record, and sends back its version', async () => {
    actions.start.mockResolvedValue({ ok: true, code: 'ABCD-2345', waMeHref: 'https://wa.me/1?text=x' })
    render(
      <WhatsappReminderCard
        initial={{ state: 'off', maskedPhone: null, assistant: 'not_offered' }}
        consent={OWNER_WA_ASSISTANT_CONSENT}
      />,
    )
    expect(screen.queryByRole('checkbox', { name: OWNER_WA_CONSENT.text })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: OWNER_WA_ASSISTANT_CONSENT.text }))
    fireEvent.click(screen.getByRole('button', { name: 'הפעלת תזכורות בוואטסאפ' }))
    await waitFor(() => expect(actions.start).toHaveBeenCalledWith({ consent: true, consentVersion: 'v3' }))
  })
})
