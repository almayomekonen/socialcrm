// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SERVICE_WINDOW_COPY } from '@/lib/inbox/whatsappComposerDecision'
import type { Template } from '@/lib/whatsapp/templates/types'

const sendTemplateToLead = vi.hoisted(() => vi.fn())
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({
  sendTemplateToLead,
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import WhatsappComposerPanel, { type WhatsappComposerFacts } from '@/components/inbox/WhatsappComposerPanel'

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

const inboundHoursAgo = (hours: number) => [
  {
    direction: 'inbound' as const,
    timestamp: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(),
  },
]

const outboundNewer = [
  { direction: 'inbound' as const, timestamp: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() },
  { direction: 'outbound' as const, timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() },
]

function facts(partial: Partial<WhatsappComposerFacts> = {}): WhatsappComposerFacts {
  return {
    health: 'operational',
    templatesEnabled: true,
    templates: [approved],
    canManageTemplates: true,
    ...partial,
  }
}

describe('WhatsappComposerPanel', () => {
  it('A — OPEN + operational → text composer', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundHoursAgo(2)}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.getByLabelText('טיוטת תשובה בוואטסאפ')).toBeInTheDocument()
    expect(screen.queryByText(SERVICE_WINDOW_COPY.closedTitle)).toBeNull()
  })

  it('E — newer outbound does not reopen a CLOSED window', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={outboundNewer}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.queryByLabelText('טיוטת תשובה בוואטסאפ')).toBeNull()
    expect(screen.getByText(SERVICE_WINDOW_COPY.closedTitle)).toBeInTheDocument()
  })

  it('J — CLOSED + flag ON + approved template → picker, no free-text', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundHoursAgo(48)}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.queryByLabelText('טיוטת תשובה בוואטסאפ')).toBeNull()
    expect(screen.getByRole('button', { name: SERVICE_WINDOW_COPY.closedCta })).toBeInTheDocument()
  })

  it('K — CLOSED + feature flag OFF → no template picker', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundHoursAgo(48)}
        facts={facts({ templatesEnabled: false, templates: [approved] })}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.queryByRole('button', { name: SERVICE_WINDOW_COPY.closedCta })).toBeNull()
    expect(screen.getByText(SERVICE_WINDOW_COPY.closedNoTemplate)).toBeInTheDocument()
  })

  it('L — CLOSED + no approved templates → explanation, no free-text', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundHoursAgo(48)}
        facts={facts({ templates: [] })}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.queryByLabelText('טיוטת תשובה בוואטסאפ')).toBeNull()
    expect(screen.getByText(SERVICE_WINDOW_COPY.closedNoTemplate)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: SERVICE_WINDOW_COPY.templatesSettings })).toBeInTheDocument()
  })

  it('H — restricted + CLOSED → blocked, no template workaround', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundHoursAgo(48)}
        facts={facts({ health: 'restricted' })}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.queryByRole('button', { name: SERVICE_WINDOW_COPY.closedCta })).toBeNull()
    expect(screen.queryByLabelText('טיוטת תשובה בוואטסאפ')).toBeNull()
    expect(screen.getByText('לא ניתן לשלוח הודעות כרגע')).toBeInTheDocument()
  })

  it('I — token health + OPEN → blocked', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundHoursAgo(2)}
        facts={facts({ health: 'token' })}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.queryByLabelText('טיוטת תשובה בוואטסאפ')).toBeNull()
    expect(screen.getByText('החיבור לוואטסאפ פג')).toBeInTheDocument()
  })

  it('Q — leadless remains blocked (no composer)', () => {
    render(
      <WhatsappComposerPanel
        leadId={null}
        messages={inboundHoursAgo(2)}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטת תשובה בוואטסאפ' />}
      />,
    )
    expect(screen.queryByLabelText('טיוטת תשובה בוואטסאפ')).toBeNull()
    expect(screen.queryByRole('button', { name: SERVICE_WINDOW_COPY.closedCta })).toBeNull()
  })

  it('N — template CTA is the existing SendReadyMessage atom (sendTemplateToLead)', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundHoursAgo(48)}
        facts={facts()}
        textComposer={<span />}
      />,
    )
    expect(screen.getByRole('button', { name: SERVICE_WINDOW_COPY.closedCta })).toBeInTheDocument()
  })

  it('desktop Inbox passes conversationId into sendTemplateToLead', async () => {
    sendTemplateToLead.mockResolvedValue({ ok: true })
    render(
      <WhatsappComposerPanel
        leadId={9}
        conversationId={44}
        messages={inboundHoursAgo(48)}
        facts={facts()}
        textComposer={<span />}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: SERVICE_WINDOW_COPY.closedCta }))
    fireEvent.click(screen.getAllByRole('radio')[0])
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))
    await waitFor(() => expect(sendTemplateToLead).toHaveBeenCalledWith(9, 7, 44))
  })

  it('WhatsappConversation threads conversationId into the composer panel', () => {
    const src = readFileSync(join(process.cwd(), 'components/summary/WhatsappConversation.tsx'), 'utf8')
    expect(src).toContain('conversationId={conversationId}')
    expect(src).toMatch(/<WhatsappComposerPanel[\s\S]*conversationId=\{conversationId\}/)
  })
})
