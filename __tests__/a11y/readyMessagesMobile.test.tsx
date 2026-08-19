// @vitest-environment jsdom
//
// P0-E — mobile Ready Messages. Same create/retry/archive/discard actions as desktop.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Template } from '@/lib/whatsapp/templates/types'

const H = vi.hoisted(() => ({
  archiveTemplate: vi.fn(),
  discardTemplate: vi.fn(),
  retryTemplate: vi.fn(),
  createTemplate: vi.fn(),
  toast: vi.fn(),
  useAdaptivePoll: vi.fn(),
}))
vi.mock('@/actions/whatsapp/templates/archiveTemplate', () => ({ archiveTemplate: H.archiveTemplate }))
vi.mock('@/actions/whatsapp/templates/discardTemplate', () => ({ discardTemplate: H.discardTemplate }))
vi.mock('@/actions/whatsapp/templates/retryTemplate', () => ({ retryTemplate: H.retryTemplate }))
vi.mock('@/actions/whatsapp/templates/createTemplate', () => ({ createTemplate: H.createTemplate }))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))
vi.mock('@/modules/inbox/client/useAdaptivePoll', () => ({ useAdaptivePoll: H.useAdaptivePoll }))

import ReadyMessagesWorkspace from '@/modules/templates/mobile/ReadyMessagesWorkspace'
import ReadyMessageEditorMobile from '@/modules/templates/mobile/ReadyMessageEditorMobile'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const tpl = (
  id: number,
  status: Template['status'],
  failureText: string | null = null,
  category?: Template['category'],
): Template => ({
  id,
  displayTitle: 'תזכורת פולואפ',
  status,
  bodyText: 'תוכן ההודעה לליד',
  variables: [],
  failureText,
  archived: false,
  createdAt: '2026-07-23T00:00:00Z',
  category,
})

describe('ReadyMessagesWorkspace — list', () => {
  it('empty state offers create, not a desktop table', () => {
    const { container } = render(<ReadyMessagesWorkspace initial={[]} />)
    expect(screen.getByRole('heading', { name: 'הודעות מוכנות' })).toBeTruthy()
    expect(screen.getByText('אין עדיין הודעות מוכנות')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'צרו הודעה מוכנה' })).toBeTruthy()
    expect(container.querySelectorAll('table')).toHaveLength(0)
  })

  it('populated list shows title, preview, status — no tiny ghost actions', () => {
    const { container } = render(<ReadyMessagesWorkspace initial={[tpl(5, 'approved', null, 'UTILITY')]} />)
    expect(screen.getByText('תזכורת פולואפ')).toBeTruthy()
    expect(screen.getByText('תוכן ההודעה לליד')).toBeTruthy()
    expect(screen.getByText('מוכנה לשליחה')).toBeTruthy()
    expect(container.querySelectorAll('table')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'ארכיון' })).toBeNull()
  })

  it('does not display a Meta slug such as lead_first_contact', () => {
    render(<ReadyMessagesWorkspace initial={[{ ...tpl(4, 'approved'), displayTitle: 'lead_first_contact' }]} />)
    expect(screen.queryByText('lead_first_contact')).toBeNull()
    expect(screen.getByText('יצירת קשר ראשוני')).toBeTruthy()
  })
})

describe('ReadyMessagesWorkspace — create/edit/delete contracts', () => {
  it('create submits through createTemplate (not a new backend)', async () => {
    H.createTemplate.mockResolvedValue({
      ok: true,
      template: tpl(99, 'pending'),
    })
    render(<ReadyMessagesWorkspace initial={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'צרו הודעה מוכנה' }))
    await waitFor(() => screen.getByPlaceholderText('למשל: תזכורת פולואפ'))
    fireEvent.change(screen.getByPlaceholderText('למשל: תזכורת פולואפ'), { target: { value: 'פולואפ' } })
    fireEvent.change(screen.getByPlaceholderText('כתבו את ההודעה שתישלח ללידים...'), {
      target: { value: 'שלום שם הליד' },
    })
    fireEvent.click(screen.getByLabelText(/עדכון או תזכורת/))
    fireEvent.click(screen.getByRole('button', { name: 'שלח לבדיקה' }))
    await waitFor(() => expect(H.createTemplate).toHaveBeenCalled())
    const input = H.createTemplate.mock.calls[0][0]
    expect(input.displayTitle).toBe('פולואפ')
    expect(input.bodyText).toContain('שלום')
    expect(input.purpose).toBe('UTILITY')
  })

  it('validation errors are visible and do not call createTemplate', () => {
    render(<ReadyMessagesWorkspace initial={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'צרו הודעה מוכנה' }))
    const submit = screen.getByRole('button', { name: 'שלח לבדיקה' })
    expect(submit).toBeDisabled()
    expect(H.createTemplate).not.toHaveBeenCalled()
  })

  it('edit of an approved template creates a NEW template', async () => {
    H.createTemplate.mockResolvedValue({ ok: true, template: tpl(11, 'pending') })
    render(<ReadyMessagesWorkspace initial={[tpl(5, 'approved', null, 'UTILITY')]} />)
    fireEvent.click(screen.getByText('תזכורת פולואפ'))
    fireEvent.click(await screen.findByRole('button', { name: 'עריכת הודעה' }))
    expect(await screen.findByRole('dialog', { name: 'עריכת הודעה' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'שלח לבדיקה' }))
    await waitFor(() => expect(H.createTemplate).toHaveBeenCalled())
    expect(H.createTemplate).toHaveBeenCalled()
    expect(H.retryTemplate).not.toHaveBeenCalled()
  })

  it('pending delete is confirm-gated and calls discardTemplate, not archive', async () => {
    H.discardTemplate.mockResolvedValue({ ok: true })
    render(<ReadyMessagesWorkspace initial={[tpl(3, 'pending')]} />)
    fireEvent.click(screen.getByText('תזכורת פולואפ'))
    fireEvent.click(screen.getByRole('button', { name: 'מחק הודעה' }))
    expect(H.discardTemplate).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'מחיקת הודעה' })).toBeTruthy()
    expect(screen.getByText(/תוסר ולא תהיה זמינה לשליחה/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await waitFor(() => expect(H.discardTemplate).toHaveBeenCalledWith(3))
    expect(H.archiveTemplate).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('תזכורת פולואפ')).toBeNull())
  })

  it('approved remove uses archiveTemplate, never discard', async () => {
    H.archiveTemplate.mockResolvedValue({ ok: true })
    render(<ReadyMessagesWorkspace initial={[tpl(8, 'approved')]} />)
    fireEvent.click(screen.getByText('תזכורת פולואפ'))
    fireEvent.click(screen.getByRole('button', { name: 'העבר לארכיון' }))
    fireEvent.click(screen.getByRole('button', { name: 'העבר לארכיון' }))
    await waitFor(() => expect(H.archiveTemplate).toHaveBeenCalledWith(8))
    expect(H.discardTemplate).not.toHaveBeenCalled()
  })

  it('failed discard keeps the row and toasts the existing error', async () => {
    H.discardTemplate.mockResolvedValue({ ok: false, error: 'לא ניתן להסיר את ההודעה' })
    render(<ReadyMessagesWorkspace initial={[tpl(3, 'pending')]} />)
    fireEvent.click(screen.getByText('תזכורת פולואפ'))
    fireEvent.click(screen.getByRole('button', { name: 'מחק הודעה' }))
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('error', 'לא ניתן להסיר את ההודעה'))
    expect(screen.getByText('תזכורת פולואפ')).toBeTruthy()
  })
})

describe('ReadyMessageEditorMobile — preview + variables', () => {
  it('surfaces closed-set variable chips and a conversation preview', () => {
    render(
      <ReadyMessageEditorMobile
        open
        onClose={() => {}}
        onCreate={() => {}}
        heading='הודעה מוכנה חדשה'
        submitLabel='שלח לבדיקה'
      />,
    )
    expect(screen.getByRole('button', { name: 'שם הליד' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'שם העסק' })).toBeTruthy()
    expect(screen.getByText('כך הליד יראה את ההודעה')).toBeTruthy()
  })
})
