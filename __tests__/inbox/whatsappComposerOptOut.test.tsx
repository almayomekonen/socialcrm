// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SERVICE_WINDOW_COPY } from '@/lib/inbox/whatsappComposerDecision'
import type { Template } from '@/lib/whatsapp/templates/types'
import { optOut as HE } from '@/lib/i18n/messages/he/inbox/composer'

vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import WhatsappComposerPanel, { type WhatsappComposerFacts } from '@/components/inbox/WhatsappComposerPanel'

/**
 * Phase 0 Item 3: while the customer is opted out the composer says so — and
 * changes nothing else. The manual reply stays available exactly as before.
 */

afterEach(() => cleanup())

const approved: Template = {
  id: 7,
  displayTitle: 'תזכורת',
  status: 'approved',
  bodyText: 'היי',
  variables: [],
  failureText: null,
  archived: false,
  createdAt: '2026-08-01T00:00:00.000Z',
}
const hoursAgo = (h: number) => [{ direction: 'inbound' as const, timestamp: new Date(Date.now() - h * 3_600_000).toISOString() }]
const facts = (p: Partial<WhatsappComposerFacts> = {}): WhatsappComposerFacts => ({
  health: 'operational',
  templatesEnabled: true,
  templates: [approved],
  canManageTemplates: true,
  ...p,
})
const draft = <textarea aria-label='טיוטת תשובה בוואטסאפ' />

describe('composer opt-out warning', () => {
  it('open window: warning above a still-usable text composer, with all three facts', () => {
    render(<WhatsappComposerPanel leadId={9} messages={hoursAgo(2)} facts={facts({ optedOut: true })} textComposer={draft} />)
    const notice = screen.getByRole('status')
    expect(within(notice).getByText(HE.title)).toBeInTheDocument()
    expect(within(notice).getByText(HE.automated)).toBeInTheDocument()
    expect(within(notice).getByText(HE.manual)).toBeInTheDocument()
    expect(within(notice).getByText(HE.templates)).toBeInTheDocument()
    expect(screen.getByLabelText('טיוטת תשובה בוואטסאפ')).toBeInTheDocument() // manual reply unchanged
  })

  it('closed window: warning above the same template state as before (no new bypass, no exception input)', () => {
    render(<WhatsappComposerPanel leadId={9} messages={hoursAgo(30)} facts={facts({ optedOut: true })} textComposer={draft} />)
    expect(screen.getByText(HE.title)).toBeInTheDocument()
    expect(screen.getByText(SERVICE_WINDOW_COPY.closedTitle)).toBeInTheDocument()
    expect(screen.queryByLabelText('טיוטת תשובה בוואטסאפ')).toBeNull()
    expect(screen.queryByRole('textbox', { name: /סיבה|reason/i })).toBeNull()
  })

  it.each([false, undefined])('optedOut=%s: no warning, rendering identical to before', (optedOut) => {
    render(<WhatsappComposerPanel leadId={9} messages={hoursAgo(2)} facts={facts({ optedOut })} textComposer={draft} />)
    expect(screen.queryByText(HE.title)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByLabelText('טיוטת תשובה בוואטסאפ')).toBeInTheDocument()
  })

  it('a leadless conversation still renders nothing, opted out or not', () => {
    const { container } = render(<WhatsappComposerPanel leadId={null} messages={hoursAgo(2)} facts={facts({ optedOut: true })} textComposer={draft} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses only approved terminology (ליד, never לקוח or סוכן) and no emoji', () => {
    const all = Object.values(HE).join(' ')
    expect(all).toMatch(/ליד/)
    expect(all).not.toMatch(/לקוח|סוכן/)
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
