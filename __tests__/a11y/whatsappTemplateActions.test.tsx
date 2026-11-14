// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

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

import TemplateRow, { type TemplateRowActions } from '@/components/settings/templates/TemplateRow'
import TemplatesWorkspace from '@/modules/templates/client/templatesStore'
import type { Template } from '@/lib/whatsapp/templates/types'

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
  bodyText: 'תוכן ההודעה',
  variables: [],
  failureText,
  archived: false,
  createdAt: '2026-07-23T00:00:00Z',
  category,
})

const spies: TemplateRowActions = { onArchive: vi.fn(), onDiscard: vi.fn(), onRetry: vi.fn() }

describe('TemplateRow — action affordances by status', () => {
  it('approved → archive only (no discard)', () => {
    render(<TemplateRow template={tpl(1, 'approved')} actions={spies} />)
    expect(screen.getByRole('button', { name: 'ארכיון' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הסר' })).toBeNull()
  })
  it('rejected → retry + discard', () => {
    render(<TemplateRow template={tpl(1, 'rejected', 'לא אושרה')} actions={spies} />)
    expect(screen.getByRole('button', { name: /עריכה ושליחה מחדש/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הסר' })).toBeInTheDocument()
  })
  it('pending → discard only', () => {
    render(<TemplateRow template={tpl(1, 'pending')} actions={spies} />)
    expect(screen.getByRole('button', { name: 'הסר' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ארכיון' })).toBeNull()
  })
  it('no actions prop → no action buttons (Sprint 2 behavior preserved)', () => {
    render(<TemplateRow template={tpl(1, 'approved')} />)
    expect(screen.queryByRole('button', { name: 'ארכיון' })).toBeNull()
  })
  it('retry is not confirm-gated — fires onRetry directly', () => {
    const onRetry = vi.fn()
    render(<TemplateRow template={tpl(9, 'rejected', 'x')} actions={{ ...spies, onRetry }} />)
    fireEvent.click(screen.getByRole('button', { name: /עריכה ושליחה מחדש/ }))
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
  })
  it('archive is confirm-gated (ConfirmPop) → onArchive only after אישור', () => {
    const onArchive = vi.fn()
    render(<TemplateRow template={tpl(5, 'approved')} actions={{ ...spies, onArchive }} />)
    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }))
    expect(onArchive).not.toHaveBeenCalled() // not yet — confirmation required
    fireEvent.click(screen.getByRole('button', { name: 'אישור' }))
    expect(onArchive).toHaveBeenCalledWith(5)
  })
})

describe('TemplatesWorkspace — mutation wiring', () => {
  it('archive success removes the row', async () => {
    H.archiveTemplate.mockResolvedValue({ ok: true })
    render(<TemplatesWorkspace initial={[tpl(5, 'approved')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }))
    fireEvent.click(screen.getByRole('button', { name: 'אישור' }))
    await waitFor(() => expect(H.archiveTemplate).toHaveBeenCalledWith(5))
    await waitFor(() => expect(screen.queryByText('תזכורת פולואפ')).toBeNull())
  })

  it('retry opens the create modal pre-filled with the rejected content', () => {
    render(<TemplatesWorkspace initial={[tpl(7, 'rejected', 'לא אושרה')]} />)
    fireEvent.click(screen.getByRole('button', { name: /עריכה ושליחה מחדש/ }))
    // modal open, title input pre-filled from the rejected template
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('תזכורת פולואפ')).toBeInTheDocument()
  })
})

describe('TemplateRow — edit affordance (safe edit-in-place)', () => {
  it('approved + onEdit → shows "עריכת הודעה"', () => {
    render(<TemplateRow template={tpl(1, 'approved')} actions={{ ...spies, onEdit: vi.fn() }} />)
    expect(screen.getByRole('button', { name: 'עריכת הודעה' })).toBeInTheDocument()
  })
  it('approved WITHOUT onEdit → no edit button', () => {
    render(<TemplateRow template={tpl(1, 'approved')} actions={spies} />)
    expect(screen.queryByRole('button', { name: 'עריכת הודעה' })).toBeNull()
  })
  it('pending + onEdit → no edit button (approved only)', () => {
    render(<TemplateRow template={tpl(1, 'pending')} actions={{ ...spies, onEdit: vi.fn() }} />)
    expect(screen.queryByRole('button', { name: 'עריכת הודעה' })).toBeNull()
  })
  it('edit fires onEdit with the template', () => {
    const onEdit = vi.fn()
    render(<TemplateRow template={tpl(3, 'approved')} actions={{ ...spies, onEdit }} />)
    fireEvent.click(screen.getByRole('button', { name: 'עריכת הודעה' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
  })
  it('an unmapped body with raw {{n}} is NOT editable (never feed Meta syntax to the editor)', () => {
    render(<TemplateRow template={{ ...tpl(1, 'approved'), bodyText: 'היי {{1}}' }} actions={{ ...spies, onEdit: vi.fn() }} />)
    expect(screen.queryByRole('button', { name: 'עריכת הודעה' })).toBeNull()
  })
})

describe('TemplatesWorkspace — "עריכת הודעה" = create a revised version (create-new)', () => {
  it('opens the modal prefilled, with an EDITABLE category (create-new can change it)', () => {
    render(<TemplatesWorkspace initial={[tpl(5, 'approved', null, 'UTILITY')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'עריכת הודעה' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'עריכת הודעה' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('תזכורת פולואפ')).toBeInTheDocument() // prefilled content
    // a note explains it creates a new version and the current one stays live
    expect(screen.getByText(/תישאר פעילה עד שהגרסה החדשה תאושר/)).toBeInTheDocument()
    // category is NOT locked — create-new allows changing it (and arity)
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).disabled)).toBe(true)
  })

  it('saving creates a NEW template (createTemplate) and never mutates the old one in place', async () => {
    H.createTemplate.mockResolvedValue({ ok: true, template: tpl(99, 'pending', null, 'UTILITY') })
    render(<TemplatesWorkspace initial={[tpl(5, 'approved', null, 'UTILITY')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'עריכת הודעה' }))
    fireEvent.click(screen.getByRole('button', { name: 'שלח לבדיקה' }))

    // goes through the ordinary create flow — NOT an in-place Meta edit
    await waitFor(() => expect(H.createTemplate).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'UTILITY' })))
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('success', expect.stringMatching(/נשלחה לאישור/)))
  })
})
