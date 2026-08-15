// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  sendTemplateToLead: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: H.sendTemplateToLead }))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))

import SendReadyMessage from '@/components/clients/SendReadyMessage'
import type { Template } from '@/lib/whatsapp/templates/types'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const tpl = (id: number, displayTitle: string): Template => ({
  id,
  displayTitle,
  status: 'approved',
  bodyText: 'היי שם הליד, יש לנו עדכון.',
  variables: [{ token: 'שם הליד', sample: 'דוד' }],
  failureText: null,
  archived: false,
  createdAt: '2026-07-23T00:00:00Z',
})

const two = [tpl(1, 'תזכורת פולואפ'), tpl(2, 'הצעה חדשה')]

describe('SendReadyMessage — affordance & dialog', () => {
  it('renders a trigger with an accessible name', () => {
    render(<SendReadyMessage leadId={9} templates={two} />)
    expect(screen.getByRole('button', { name: 'שלח הודעה מוכנה' })).toBeInTheDocument()
  })

  it('opens a labelled dialog listing the approved messages, send disabled until a pick', () => {
    render(<SendReadyMessage leadId={9} templates={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('תזכורת פולואפ')).toBeInTheDocument()
    expect(screen.getByText('הצעה חדשה')).toBeInTheDocument()
    // primary send is disabled with nothing selected
    expect(screen.getByRole('button', { name: 'שלח הודעה' })).toBeDisabled()
  })

  it('selecting a message enables send', () => {
    render(<SendReadyMessage leadId={9} templates={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(screen.getByRole('button', { name: 'שלח הודעה' })).toBeEnabled()
  })
})

describe('SendReadyMessage — send flow', () => {
  it('sends the selected template for this lead and confirms on success', async () => {
    H.sendTemplateToLead.mockResolvedValue({ ok: true })
    render(<SendReadyMessage leadId={9} templates={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    fireEvent.click(screen.getAllByRole('radio')[1]) // second template (id=2)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))

    await waitFor(() => expect(H.sendTemplateToLead).toHaveBeenCalledWith(9, 2))
    expect(H.sendTemplateToLead.mock.calls[0]).toHaveLength(2)
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('success', 'ההודעה נשלחה'))
    // dialog closes on success
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows the mapped error and keeps the dialog open on failure', async () => {
    H.sendTemplateToLead.mockResolvedValue({ ok: false, error: 'ההודעה לא נשלחה. נסו שוב.' })
    render(<SendReadyMessage leadId={9} templates={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    fireEvent.click(screen.getAllByRole('radio')[0])
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))

    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('error', 'ההודעה לא נשלחה. נסו שוב.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Inbox conversationId is forwarded; lead page still omits it', async () => {
    H.sendTemplateToLead.mockResolvedValue({ ok: true })
    render(<SendReadyMessage leadId={9} templates={two} conversationId={44} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    fireEvent.click(screen.getAllByRole('radio')[0])
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))
    await waitFor(() => expect(H.sendTemplateToLead).toHaveBeenCalledWith(9, 1, 44))
  })

  it('duplicate click while sending does not call the action twice', async () => {
    let release!: () => void
    H.sendTemplateToLead.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true })
      }),
    )
    render(<SendReadyMessage leadId={9} templates={two} conversationId={44} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    fireEvent.click(screen.getAllByRole('radio')[0])
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))
    fireEvent.click(screen.getByRole('button', { name: 'שולח…' }))
    expect(H.sendTemplateToLead).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('success', 'ההודעה נשלחה'))
  })
})
