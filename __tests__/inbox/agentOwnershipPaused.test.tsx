// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AgentOwnershipClient from '@/modules/inbox/components/AgentOwnershipClient'

vi.mock('@/actions/inbox/agentOwnership', () => ({
  takeOverConversation: vi.fn(),
  returnToAgent: vi.fn(),
}))

/**
 * WHAT THE OWNER SEES when the AI reply is on but the plan does not include it:
 * one calm line in the thread saying nothing answered the customer, and where
 * to look. No ownership control — there is no decision to make here.
 */
afterEach(cleanup)

describe('the paused-for-plan line', () => {
  it('says the automatic reply is paused and the customer got no automatic answer', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned={false} handedOff={false} pausedForPlan />)
    expect(screen.getByText(/המענה האוטומטי מושהה/)).toBeTruthy()
    expect(screen.getByText(/הלקוח לא קיבל תשובה אוטומטית/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /הגדרות המענה האוטומטי/ }).getAttribute('href')).toBe('/settings/auto-response')
  })

  it('offers no take-over or return control', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned={false} handedOff={false} pausedForPlan />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is absent unless asked for: the ordinary line is unchanged', () => {
    render(<AgentOwnershipClient conversationId={1} humanOwned={false} handedOff={false} />)
    expect(screen.queryByText(/המענה האוטומטי מושהה/)).toBeNull()
    expect(screen.getByText('הסוכן עונה בשיחה הזו.')).toBeTruthy()
  })
})
