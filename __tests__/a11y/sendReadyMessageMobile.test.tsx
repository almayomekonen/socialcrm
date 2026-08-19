// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Template } from '@/lib/whatsapp/templates/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SERVICE_WINDOW_COPY } from '@/lib/inbox/whatsappComposerDecision'

const sendTemplateToLead = vi.hoisted(() => vi.fn())
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}))

import SendReadyMessageMobile from '@/components/clients/SendReadyMessageMobile'
import ConversationThreadMobile from '@/modules/inbox/mobile/ConversationThreadMobile'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

const approved: Template = {
  id: 7,
  displayTitle: 'תזכורת',
  status: 'approved',
  bodyText: 'היי שם הליד',
  variables: [{ token: 'שם הליד', sample: 'דוד' }],
  failureText: null,
  archived: false,
  createdAt: '2026-08-01T00:00:00.000Z',
}

describe('SendReadyMessageMobile', () => {
  it('sends through sendTemplateToLead with conversationId — no second implementation', async () => {
    sendTemplateToLead.mockResolvedValue({ ok: true })
    render(<SendReadyMessageMobile leadId={9} conversationId={44} templates={[approved]} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    fireEvent.click(screen.getAllByRole('radio')[0])
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))
    await waitFor(() => expect(sendTemplateToLead).toHaveBeenCalledWith(9, 7, 44))
  })

  it('is a bottom sheet, not the desktop middle modal', () => {
    render(<SendReadyMessageMobile leadId={9} templates={[approved]} />)
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה מוכנה' }))
    const dialog = screen.getByRole('dialog', { name: 'שליחת הודעה מוכנה' })
    expect(dialog.className).toMatch(/rounded-t-2xl/)
    expect(screen.getByText('תצוגה מקדימה')).toBeTruthy()
  })
})

describe('mobile conversation uses the sheet picker', () => {
  it('ConversationThreadMobile asks the composer for the sheet surface', () => {
    const src = readFileSync(join(process.cwd(), 'modules/inbox/mobile/ConversationThreadMobile.tsx'), 'utf8')
    expect(src).toContain("readyMessageSurface='sheet'")
  })

  it('WhatsappComposerPanel defaults to the desktop modal', () => {
    const src = readFileSync(join(process.cwd(), 'components/inbox/WhatsappComposerPanel.tsx'), 'utf8')
    expect(src).toContain("readyMessageSurface = 'modal'")
    expect(src).toContain('SendReadyMessageMobile')
    expect(src).toContain("from '@/components/clients/SendReadyMessage'")
  })

  it('mobile Inbox still passes conversationId into sendTemplateToLead', async () => {
    sendTemplateToLead.mockResolvedValue({ ok: true })
    render(
      <ConversationThreadMobile
        conversationId={44}
        leadId={9}
        displayName='דוד'
        initialMessages={[
          {
            id: 1,
            direction: 'inbound',
            type: 'text',
            text: 'היי',
            timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
            status: 'received',
            failureText: null,
            failureCategory: null,
          },
        ]}
        composerFacts={{
          health: 'operational',
          templatesEnabled: true,
          templates: [approved],
          canManageTemplates: false,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: SERVICE_WINDOW_COPY.closedCta }))
    fireEvent.click(screen.getAllByRole('radio')[0])
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))
    await waitFor(() => expect(sendTemplateToLead).toHaveBeenCalledWith(9, 7, 44))
  })
})
