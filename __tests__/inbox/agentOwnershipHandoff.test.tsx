// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AgentOwnershipClient from '@/modules/inbox/components/AgentOwnershipClient'

vi.mock('@/actions/inbox/agentOwnership', () => ({
  takeOverConversation: vi.fn(),
  returnToAgent: vi.fn(),
}))

/**
 * WHAT A REP SEES when the agent has passed a request to a person.
 *
 * Rendered from the handoff note alone. The conversation-intelligence card is
 * gated on the analysis worker's separate `summary` row, so a freshly handed-off
 * conversation — which has only `qualification_summary` — showed nothing at all,
 * and a request the customer was told had been passed on was invisible.
 */
afterEach(cleanup)

const HANDOFF = {
  name: 'קרן מקונן',
  businessType: 'מספרת כלבים',
  need: 'ניהול פניות ולקוחות',
  urgency: 'מיידי',
  temperature: 'hot',
}

describe('a handed-off conversation is visible and actionable', () => {
  it('shows the waiting indicator', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned handedOff handoff={HANDOFF} />)
    expect(screen.getByText('ממתין לטיפול נציג')).toBeTruthy()
  })

  it('shows name, business type, request and urgency', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned handedOff handoff={HANDOFF} />)
    expect(screen.getByText('קרן מקונן')).toBeTruthy()
    expect(screen.getByText('מספרת כלבים')).toBeTruthy()
    expect(screen.getByText('ניהול פניות ולקוחות')).toBeTruthy()
    expect(screen.getByText('דחיפות: מיידי')).toBeTruthy()
  })

  it('renders with ONLY the handoff note — no analysis summary needed', () => {
    // The component receives nothing from the intelligence card's summary row.
    render(<AgentOwnershipClient conversationId={1} humanOwned handedOff handoff={HANDOFF} />)
    expect(screen.getByText('ממתין לטיפול נציג')).toBeTruthy()
    expect(screen.getByText('קרן מקונן')).toBeTruthy()
  })

  it('omits fields the customer never supplied rather than showing a dash', () => {
    render(
      <AgentOwnershipClient
        conversationId={1}
        humanOwned
        handedOff
        handoff={{ name: 'דנה', businessType: null, need: null, urgency: null, temperature: null }}
      />,
    )
    expect(screen.getByText('דנה')).toBeTruthy()
    expect(screen.queryByText('סוג העסק:')).toBeNull()
    expect(screen.queryByText(/דחיפות/)).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('still renders the indicator when the note itself is missing', () => {
    // A handoff whose note write failed must not become invisible.
    render(<AgentOwnershipClient conversationId={1} humanOwned handedOff handoff={null} />)
    expect(screen.getByText('ממתין לטיפול נציג')).toBeTruthy()
  })

  it('REUSES the existing takeover control rather than adding a second one', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned handedOff handoff={HANDOFF} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe('החזרת המענה לסוכן')
  })

  it('says the agent is waiting, and does not promise anyone will call', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned handedOff handoff={HANDOFF} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('הסוכן לא ישלח הודעות נוספות')
    expect(text).not.toMatch(/יחזור אלי|בהקדם/)
  })
})

describe('the indicator is specific to a handoff', () => {
  it('a rep who took over manually sees no waiting badge', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned handedOff={false} handoff={null} />)
    expect(screen.queryByText('ממתין לטיפול נציג')).toBeNull()
    expect(screen.getByText(/אתם עונים בשיחה הזו/)).toBeTruthy()
  })

  it('an agent-owned conversation shows the take-over control and no badge', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned={false} handedOff={false} handoff={null} />)
    expect(screen.queryByText('ממתין לטיפול נציג')).toBeNull()
    expect(screen.getByRole('button').textContent).toBe('אני עונה מכאן')
  })
})
