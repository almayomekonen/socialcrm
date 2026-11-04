// @vitest-environment jsdom
/**
 * The lead notes section as a rep meets it: labelled box, a named delete, a
 * confirmation before deleting, and a failed save that keeps the typed text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import React from 'react'

const addLeadNote = vi.fn()
const deleteLeadNote = vi.fn()
vi.mock('@/actions/leadNotes', () => ({
  addLeadNote: (...a: unknown[]) => addLeadNote(...a),
  deleteLeadNote: (...a: unknown[]) => deleteLeadNote(...a),
}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/useAction', async () => {
  const { useState } = await import('react')
  return {
    ENTITLEMENT_ERROR: 'ENTITLEMENT_EXPIRED',
    useAction: () => {
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState<string | null>(null)
      return {
        loading,
        error,
        setError,
        run: async (fn: () => Promise<void>) => {
          setLoading(true)
          try {
            await fn()
          } catch {
            setError('משהו השתבש, נסה שוב')
          } finally {
            setLoading(false)
          }
        },
      }
    },
  }
})
vi.mock('@/lib/modals/ConfirmPop', () => ({
  default: ({ open, msg, confirmLbl, onConfirm }: any) =>
    open ? (
      <div role='dialog' aria-label={msg}>
        <button onClick={onConfirm}>{confirmLbl}</button>
      </div>
    ) : null,
}))

import LeadNotes from '@/components/leads/LeadNotes'

const existing = { id: 1, userName: 'נועה', content: 'דיברנו בבוקר', createdAt: '2026-11-04T07:30:00.000Z' }

describe('LeadNotes', () => {
  beforeEach(() => {
    addLeadNote.mockReset()
    deleteLeadNote.mockReset()
  })
  afterEach(cleanup)

  it('shows guidance when there are no notes, and the add button waits for text', () => {
    render(<LeadNotes leadId={5} notes={[]} surface='desktop' />)
    expect(screen.getByText(/עדיין אין הערות על הליד הזה/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /הוסף הערה/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('textbox', { name: /מה נאמר בשיחה/ })).toBeTruthy()
  })

  it('adds the saved note to the top and clears the box', async () => {
    addLeadNote.mockResolvedValue({ note: { id: 2, userName: 'נועה', content: 'סיכמנו על מחר', createdAt: '2026-11-04T08:00:00.000Z' } })
    render(<LeadNotes leadId={5} notes={[existing]} surface='desktop' />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'סיכמנו על מחר' } })
    fireEvent.click(screen.getByRole('button', { name: /הוסף הערה/ }))

    await screen.findByText('סיכמנו על מחר')
    expect(addLeadNote).toHaveBeenCalledWith({ leadId: 5, content: 'סיכמנו על מחר' })
    expect(box.value).toBe('')
  })

  it('keeps text typed while the previous note was still saving', async () => {
    let finish: (v: unknown) => void = () => {}
    addLeadNote.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<LeadNotes leadId={5} notes={[]} surface='desktop' />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'הראשונה' } })
    fireEvent.click(screen.getByRole('button', { name: /הוסף הערה/ }))
    fireEvent.change(box, { target: { value: 'השנייה' } })
    finish({ note: { id: 3, userName: 'נועה', content: 'הראשונה', createdAt: '2026-11-04T08:00:00.000Z' } })

    await screen.findByText('הראשונה')
    expect(box.value).toBe('השנייה')
  })

  it('keeps the typed text and explains when the save fails', async () => {
    addLeadNote.mockRejectedValue(new Error('network'))
    render(<LeadNotes leadId={5} notes={[]} surface='mobile' />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'טקסט חשוב' } })
    fireEvent.click(screen.getByRole('button', { name: /הוסף הערה/ }))

    await screen.findByText('משהו השתבש, נסה שוב')
    expect(box.value).toBe('טקסט חשוב')
  })

  it('asks before deleting, then removes the note', async () => {
    deleteLeadNote.mockResolvedValue({ ok: true })
    render(<LeadNotes leadId={5} notes={[existing]} surface='desktop' />)
    fireEvent.click(screen.getByRole('button', { name: 'מחק הערה' }))
    expect(deleteLeadNote).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'מחק הערה' }).at(-1)!)
    await waitFor(() => expect(screen.queryByText('דיברנו בבוקר')).toBeNull())
    expect(deleteLeadNote).toHaveBeenCalledWith({ id: 1 })
  })

  it('renders the same time whatever the machine timezone, so hydration cannot break', () => {
    const original = process.env.TZ
    const html = (tz: string) => {
      process.env.TZ = tz
      return renderToString(<LeadNotes leadId={5} notes={[existing]} surface='desktop' />)
    }
    const utc = html('UTC')
    const jerusalem = html('Asia/Jerusalem')
    process.env.TZ = original
    expect(utc).toBe(jerusalem)
    expect(utc).toContain('09:30')
  })
})
