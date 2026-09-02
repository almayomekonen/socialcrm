// @vitest-environment jsdom
//
// The invitation submit boundary.
//
// The backend was never the problem: sendInvitation inserts, sends through
// Resend and the redemption route mints a real session. The defect was here —
// the handler discarded api()'s return, and sendInvitation reports its expected
// failures by RETURNING { error } rather than throwing, so api() fell through to
// its success toast and a failed invitation announced itself as sent. Production
// has 0 invitations all-time and no admin ever saw an error.
//
//   NODE_ENV=test VITEST_NO_DB=1 npx vitest run __tests__/settings

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ toasts: [] as string[] }))

vi.mock('@/lib/toast', () => ({
  toast: (icon: string) => {
    h.toasts.push(icon)
  },
}))
vi.mock('@/actions/invitations', () => ({
  sendInvitation: vi.fn(async () => ({ success: true })),
  deleteInvitation: vi.fn(async () => {}),
}))
vi.mock('@/actions/auth', () => ({ isUserExists: vi.fn(async () => ({ fail: true })) }))
vi.mock('@/actions/global', () => ({ saveTblPref: vi.fn(async () => {}) }))

import InvitationsTable from '@/components/invitations/InvitationsTable'
import { sendInvitation } from '@/actions/invitations'
import { isUserExists } from '@/actions/auth'

function submit() {
  const { container } = render(<InvitationsTable data={[]} tblPref={null} />)
  const form = container.querySelector('form') as HTMLFormElement
  const set = (name: string, value: string) => {
    const el = form.querySelector(`[name=${name}]`) as HTMLInputElement | HTMLSelectElement
    if (el) fireEvent.change(el, { target: { value } })
  }
  set('firstName', 'דנה')
  set('lastName', 'לוי')
  set('email', 'dana@example.com')
  set('role', 'AGNT')
  fireEvent.submit(form)
  return form
}

beforeEach(() => {
  cleanup()
  // Call history is asserted exactly; implementations are re-established below,
  // so this must come first.
  vi.clearAllMocks()
  h.toasts = []
  vi.mocked(isUserExists).mockResolvedValue({ fail: true } as never)
  vi.mocked(sendInvitation).mockResolvedValue({ success: true } as never)
})

describe('a successful AGNT invitation', () => {
  it('reaches sendInvitation with the submitted role', async () => {
    submit()
    await waitFor(() => expect(sendInvitation).toHaveBeenCalled())
    expect(vi.mocked(sendInvitation).mock.calls[0][0]).toMatchObject({ email: 'dana@example.com', role: 'AGNT' })
  })

  it('still reports success and shows no error dialog', async () => {
    submit()
    await waitFor(() => expect(h.toasts).toContain('success'))
    expect(screen.queryByText(/אירעה שגיאה/)).toBeNull()
  })

  it('resets the form, matching ExtUserForm’s existing pattern', async () => {
    const form = submit()
    await waitFor(() => expect(sendInvitation).toHaveBeenCalled())
    await waitFor(() => {
      expect((form.querySelector('[name=email]') as HTMLInputElement).value).toBe('')
      expect((form.querySelector('[name=firstName]') as HTMLInputElement).value).toBe('')
    })
  })
})

describe('a returned { error } is an error, never a success', () => {
  it('renders the server’s message instead of a success toast', async () => {
    vi.mocked(sendInvitation).mockResolvedValueOnce({ error: 'שליחת ההזמנה נכשלה. נסה שוב.' } as never)
    submit()
    await waitFor(() => expect(screen.getByText('שליחת ההזמנה נכשלה. נסה שוב.')).toBeTruthy())
    expect(h.toasts).not.toContain('success')
  })

  it('surfaces a permission rejection rather than swallowing it', async () => {
    vi.mocked(sendInvitation).mockResolvedValueOnce({ error: 'אין הרשאה' } as never)
    submit()
    await waitFor(() => expect(screen.getByText('אין הרשאה')).toBeTruthy())
    expect(h.toasts).not.toContain('success')
  })

  it('does not reset the form when the invitation failed', async () => {
    vi.mocked(sendInvitation).mockResolvedValueOnce({ error: 'אין הרשאה' } as never)
    const form = submit()
    await waitFor(() => expect(screen.getByText('אין הרשאה')).toBeTruthy())
    expect((form.querySelector('[name=email]') as HTMLInputElement).value).toBe('dana@example.com')
  })
})

describe('a thrown server action can no longer end the submit in silence', () => {
  it('surfaces an isUserExists rejection', async () => {
    vi.mocked(isUserExists).mockRejectedValueOnce(new Error('boom'))
    submit()
    await waitFor(() => expect(screen.getByText(/boom|אירעה שגיאה/)).toBeTruthy())
    expect(sendInvitation).not.toHaveBeenCalled()
    expect(h.toasts).not.toContain('success')
  })

  it('surfaces a sendInvitation rejection', async () => {
    vi.mocked(sendInvitation).mockRejectedValueOnce(new Error('network down'))
    submit()
    await waitFor(() => expect(screen.getByText(/network down|אירעה שגיאה/)).toBeTruthy())
    expect(h.toasts).not.toContain('success')
  })

  it('an existing user is still blocked before any invitation is sent', async () => {
    vi.mocked(isUserExists).mockResolvedValueOnce({ id: 99 } as never)
    submit()
    await waitFor(() => expect(screen.getByText('המשתמש כבר קיים')).toBeTruthy())
    expect(sendInvitation).not.toHaveBeenCalled()
  })
})
