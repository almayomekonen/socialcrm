// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AssistantDemo from '@/components/admin/whatsapp/assistantDemo/AssistantDemo'
import { SCENARIOS } from '@/components/admin/whatsapp/assistantDemo/scenarios'

/** The WhatsApp assistant demo: always labelled a simulation, never touches the network. */
const EMOJI = /\p{Extended_Pictographic}/u
let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('SocialCRM AI WhatsApp demo', () => {
  it('says it is a simulation, labels what really exists, and has no emoji', () => {
    const { container } = render(<AssistantDemo />)
    expect(screen.getByRole('note')).toHaveTextContent('הדמיה בלבד')
    expect(screen.getByRole('region', { name: 'שיחת הדמיה' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /סיכום יום.*קיים בפיילוט/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /קביעת פגישה.*עדיין לא קיים/ })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(EMOJI)
  })

  it('plays a pilot scenario with a progress state, then the answer', async () => {
    render(<AssistantDemo />)
    await advance(600)
    expect(screen.getByText('סכם לי את היום')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('בודק את המצב היום')
    await advance(2000)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/היום יש 3 לידים שמחכים לך/)).toBeInTheDocument()
  })

  it('the meeting flow: locate, check availability, confirm card, then a success labelled as simulated', async () => {
    render(<AssistantDemo />)
    fireEvent.click(screen.getByRole('button', { name: /קביעת פגישה/ }))
    await advance(1000)
    expect(screen.getByRole('status')).toHaveTextContent('מאתר ליד')
    await advance(6000)
    expect(screen.getByText('לאשר את הפגישה?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'לאשר ולקבוע' }))
    await advance(400)
    expect(screen.getByRole('status')).toHaveTextContent('יוצר פגישה')
    await advance(3000)
    expect(screen.getByText('הפגישה נקבעה (בהדמיה)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'לאשר ולקבוע' })).toBeNull()
  })

  it('cancel and the conflict error are shown honestly', async () => {
    render(<AssistantDemo />)
    fireEvent.click(screen.getByRole('button', { name: /קביעת פגישה/ }))
    await advance(7000)
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    await advance(1000)
    expect(screen.getByText('בסדר, לא נקבעה פגישה.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /התנגשות ביומן/ }))
    await advance(5000)
    expect(screen.getByRole('alert')).toHaveTextContent('השעה תפוסה')
  })

  it('never calls the network', async () => {
    render(<AssistantDemo />)
    for (const s of SCENARIOS) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(s.title) }))
      await advance(8000)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the meeting scenarios are marked future, the read-only ones pilot', () => {
    expect(SCENARIOS.filter((s) => s.availability === 'future').map((s) => s.id)).toEqual(['meeting', 'conflict'])
  })
})
