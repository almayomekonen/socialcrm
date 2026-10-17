// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/** The one-off test-send control: labelled, confirmed, one attempt, then disabled. */
const action = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/actions/admin/ownerWaOneOff', () => ({ sendOwnerWaOneOffTestAction: (...a: unknown[]) => action.run(...a) }))

import OneOffTestSend from '@/components/admin/whatsapp/OneOffTestSend'

const EMOJI = /\p{Extended_Pictographic}/u
const field = () => screen.getByLabelText('מזהה השיחה')
const start = () => screen.getByRole('button', { name: 'שליחת תזכורת בדיקה אחת' })

beforeEach(() => {
  action.run.mockReset()
  action.run.mockResolvedValue({ outcome: 'sent', deliveryId: 9, wamid: 'wamid.ACCEPTED' })
})
afterEach(cleanup)

async function sendFor(id: string) {
  fireEvent.change(field(), { target: { value: id } })
  fireEvent.click(start())
  fireEvent.click(screen.getByRole('button', { name: `לאשר שליחה על שיחה ${id}` }))
}

describe('OneOffTestSend', () => {
  it('is a labelled region with a labelled field and a named button, no emoji', () => {
    const { container } = render(<OneOffTestSend />)
    expect(screen.getByRole('region', { name: 'שליחת תזכורת בדיקה אחת' })).toBeInTheDocument()
    expect(field()).toBeInTheDocument()
    expect(start()).toBeDisabled()
    expect(container.textContent).not.toMatch(EMOJI)
  })

  it('needs a numeric id, then an explicit confirmation naming the conversation', async () => {
    render(<OneOffTestSend />)
    fireEvent.change(field(), { target: { value: 'abc' } })
    expect(start()).toBeDisabled()
    fireEvent.change(field(), { target: { value: '20527' } })
    fireEvent.click(start())
    expect(action.run).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'לאשר שליחה על שיחה 20527' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(start()).toBeInTheDocument()
    expect(action.run).not.toHaveBeenCalled()
  })

  it('runs once with the number, reports acceptance (not delivery), then stays disabled', async () => {
    render(<OneOffTestSend />)
    await sendFor('20527')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Meta קיבלה את ההודעה'))
    expect(screen.getByRole('status')).toHaveTextContent('המסירה תאושר רק')
    expect(action.run).toHaveBeenCalledTimes(1)
    expect(action.run).toHaveBeenCalledWith(20527)
    expect(start()).toBeDisabled()
    expect(field()).toBeDisabled()
  })

  it('an unknown outcome says not to retry, as an alert, and locks the control', async () => {
    action.run.mockResolvedValueOnce({ outcome: 'unknown', deliveryId: 9, reason: 'timeout' })
    render(<OneOffTestSend />)
    await sendFor('20527')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('לא לנסות שוב'))
    expect(start()).toBeDisabled()
    expect(action.run).toHaveBeenCalledTimes(1)
  })

  it('a refusal is explained in Hebrew and locks the control', async () => {
    action.run.mockResolvedValueOnce({ outcome: 'refused', reason: 'already_used' })
    render(<OneOffTestSend />)
    await sendFor('20527')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('כבר נוצלה'))
    expect(start()).toBeDisabled()
  })
})
