// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const { createTemplate, toast } = vi.hoisted(() => ({ createTemplate: vi.fn(), toast: vi.fn() }))
vi.mock('@/actions/whatsapp/templates/createTemplate', () => ({ createTemplate }))
vi.mock('@/lib/toast', () => ({ toast }))

import CreateTemplateModal from '@/components/settings/templates/CreateTemplateModal'
import TemplatesWorkspace from '@/modules/templates/client/templatesStore'
import type { Template, TemplateInput } from '@/lib/whatsapp/templates/types'

afterEach(() => {
  cleanup()
  createTemplate.mockReset()
  toast.mockReset()
})

const confirmed: Template = {
  id: 55,
  displayTitle: 'תזכורת פולואפ',
  status: 'pending',
  bodyText: 'היי שם הליד',
  variables: [],
  failureText: null,
  archived: false,
  createdAt: '2026-07-23T00:00:00Z',
}

function fillValidForm() {
  fireEvent.change(screen.getByPlaceholderText('למשל: תזכורת פולואפ'), { target: { value: 'תזכורת פולואפ' } })
  fireEvent.change(screen.getByPlaceholderText(/כתבו את ההודעה/), { target: { value: 'היי, רצינו להזכיר.' } })
  fireEvent.click(screen.getByLabelText(/עדכון או תזכורת/))
}

describe('CreateTemplateModal — a11y & form', () => {
  it('is a labelled dialog with the create heading', () => {
    render(<CreateTemplateModal open onClose={() => {}} onCreate={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby', 'create-template-title')
    expect(screen.getByRole('heading', { name: 'הודעה מוכנה חדשה' })).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(<CreateTemplateModal open={false} onClose={() => {}} onCreate={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('inserts a variable chip into the body', () => {
    render(<CreateTemplateModal open onClose={() => {}} onCreate={() => {}} />)
    const body = screen.getByPlaceholderText(/כתבו את ההודעה/) as HTMLTextAreaElement
    fireEvent.change(body, { target: { value: 'היי ' } })
    body.setSelectionRange(4, 4)
    fireEvent.click(screen.getByRole('button', { name: '+ שם הליד' }))
    expect(body.value).toContain('שם הליד')
  })

  it('blocks submit and shows Hebrew errors on invalid input', () => {
    const onCreate = vi.fn()
    render(<CreateTemplateModal open onClose={() => {}} onCreate={onCreate} />)
    // title/body empty, no purpose → submit is disabled; force validation via a partial fill
    fireEvent.change(screen.getByPlaceholderText('למשל: תזכורת פולואפ'), { target: { value: 'x' } })
    fireEvent.change(screen.getByPlaceholderText(/כתבו את ההודעה/), { target: { value: 'y' } })
    // no purpose chosen yet → button disabled, so onCreate not called
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('hands a valid TemplateInput to onCreate', () => {
    const onCreate = vi.fn()
    render(<CreateTemplateModal open onClose={() => {}} onCreate={onCreate} />)
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'שלח לבדיקה' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    const input = onCreate.mock.calls[0][0] as TemplateInput
    expect(input).toMatchObject({ displayTitle: 'תזכורת פולואפ', purpose: 'UTILITY' })
  })
})

describe('TemplatesWorkspace — optimistic flow', () => {
  it('adds an optimistic pending row on submit, then reconciles on success', async () => {
    createTemplate.mockResolvedValue({ ok: true, template: confirmed })
    render(<TemplatesWorkspace initial={[]} />)

    // empty → open via the CTA
    fireEvent.click(screen.getByRole('button', { name: /צור הודעה מוכנה/ }))
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'שלח לבדיקה' }))

    // optimistic row appears immediately (בבדיקת וואטסאפ), modal closed
    expect(screen.getByText('תזכורת פולואפ')).toBeInTheDocument()
    expect(screen.getByText('בבדיקת וואטסאפ')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()

    await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', expect.stringMatching(/לאישור וואטסאפ/)))
  })

  it('rolls the optimistic row back and toasts the mapped Hebrew error on failure', async () => {
    createTemplate.mockResolvedValue({ ok: false, error: 'הגעתם למכסת ההודעות היומית של וואטסאפ. נסו שוב מחר.' })
    render(<TemplatesWorkspace initial={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /צור הודעה מוכנה/ }))
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'שלח לבדיקה' }))

    expect(screen.getByText('תזכורת פולואפ')).toBeInTheDocument() // optimistic present

    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', expect.stringMatching(/מכסת/)))
    // rolled back → the optimistic row is gone, back to the empty state
    await waitFor(() => expect(screen.queryByText('תזכורת פולואפ')).toBeNull())
    expect(screen.getByText('אין עדיין הודעות WhatsApp מוכנות')).toBeInTheDocument()
  })
})
