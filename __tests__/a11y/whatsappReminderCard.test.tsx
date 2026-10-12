// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const actions = vi.hoisted(() => ({ start: vi.fn(), off: vi.fn() }))
vi.mock('@/actions/whatsappReminders', () => ({
  startWhatsappReminderActivation: actions.start,
  turnOffWhatsappReminders: actions.off,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import WhatsappReminderCard from '@/components/settings/whatsappReminders/WhatsappReminderCard'

const EMOJI = /\p{Extended_Pictographic}/u

afterEach(() => {
  cleanup()
  actions.start.mockReset()
  actions.off.mockReset()
})

describe('WhatsappReminderCard', () => {
  it('off: the consent box must be ticked before a code can be requested', async () => {
    actions.start.mockResolvedValue({ ok: true, code: 'ABCD-2345', waMeHref: 'https://wa.me/1?text=x' })
    render(<WhatsappReminderCard initial={{ state: 'off', maskedPhone: null }} />)
    const button = screen.getByRole('button', { name: 'הפעלת תזכורות בוואטסאפ' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'צריך לאשר קבלת תזכורות')
    fireEvent.click(screen.getByRole('checkbox'))
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText('ABCD-2345')).toBeInTheDocument())
    expect(actions.start).toHaveBeenCalledWith({ consent: true })
    expect(screen.getByRole('button', { name: 'שליחת הקוד בוואטסאפ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'בדיקה אם התזכורות פעילות' })).toBeInTheDocument()
  })

  it('active: shows only the masked number and a way to turn off', () => {
    render(<WhatsappReminderCard initial={{ state: 'active', maskedPhone: '••••••72' }} />)
    expect(screen.getByText('••••••72')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'כיבוי תזכורות' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('pending: says the code is shown once, offers a new code and cancelling', () => {
    render(<WhatsappReminderCard initial={{ state: 'pending', maskedPhone: null }} />)
    expect(screen.getByRole('button', { name: 'יצירת קוד הפעלה חדש' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeInTheDocument()
  })

  it('stopped: says so and offers to start again with consent', () => {
    render(<WhatsappReminderCard initial={{ state: 'opted_out', maskedPhone: null }} />)
    expect(screen.getByText('התזכורות כבויות')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('no state renders an emoji', () => {
    for (const state of ['off', 'pending', 'active', 'opted_out'] as const) {
      const { container, unmount } = render(<WhatsappReminderCard initial={{ state, maskedPhone: '••••••72' }} />)
      expect(container.textContent).not.toMatch(EMOJI)
      unmount()
    }
  })
})
