// @vitest-environment jsdom
//
// THE COMPOSER'S NATIVE FALLBACK.
//
// Two composer states block sending for reasons that are genuinely Meta's:
//
//   window_unknown            the customer has never messaged this business, so
//                             no 24h service window was ever opened. This is the
//                             state of EVERY manually created and every imported
//                             lead — 200 of the 201 in the account that prompted
//                             this work.
//   window_closed_no_template the window closed and no approved template exists.
//
// The connected account that reached the second state wrote to support to say
// so: "אם אני רוצה להוסיף לקוח לתקשורת בוואטס אפ - אין אפשרות כזאת". They were
// right, and the API rule is real — but it constrains our Business API, not the
// rep's own phone. These tests pin that the composer now offers the handoff, and
// that the two states which ALREADY work are left alone.
//
// Runs without a database (VITEST_NO_DB=1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Template } from '@/lib/whatsapp/templates/types'

const recordEvent = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: (...args: unknown[]) => recordEvent(...args),
}))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import WhatsappComposerPanel, { type WhatsappComposerFacts } from '@/components/inbox/WhatsappComposerPanel'

const CUSTOMER_WA = '972541234567'
const FALLBACK = { name: 'פתיחת השיחה בוואטסאפ' }

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

/** No inbound at all → the service window resolves UNKNOWN. */
const noInbound: { direction: string; timestamp?: string | null }[] = []
/** Inbound older than 24h → CLOSED. */
const inboundStale = [{ direction: 'inbound', timestamp: new Date(Date.now() - 30 * 3600_000).toISOString() }]
/** Inbound within 24h → OPEN. */
const inboundFresh = [{ direction: 'inbound', timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }]

function facts(partial: Partial<WhatsappComposerFacts> = {}): WhatsappComposerFacts {
  return {
    health: 'operational',
    templatesEnabled: false,
    templates: [],
    canManageTemplates: false,
    customerWaId: CUSTOMER_WA,
    ...partial,
  }
}

const events = (name: string) =>
  recordEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>)

beforeEach(() => recordEvent.mockClear())
afterEach(() => cleanup())

describe('composer native fallback', () => {
  it('CF-1: window_unknown → a real wa.me anchor for the customer', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={noInbound}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטה' />}
      />,
    )

    const link = screen.getByRole('link', FALLBACK)
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe(`https://wa.me/${CUSTOMER_WA}`)
    // The in-app composer is still correctly withheld — we add a way out, we do
    // not pretend the API can send.
    expect(screen.queryByLabelText('טיוטה')).toBeNull()
  })

  it('CF-2: closed window with no approved template → the same anchor', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundStale}
        facts={facts({ templatesEnabled: false, templates: [] })}
        textComposer={<textarea aria-label='טיוטה' />}
      />,
    )
    expect(screen.getByRole('link', FALLBACK).getAttribute('href')).toBe(`https://wa.me/${CUSTOMER_WA}`)
  })

  it('CF-3: tapping the fallback emits clicked + succeeded(whatsapp_native)', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={noInbound}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטה' />}
      />,
    )

    fireEvent.click(screen.getByRole('link', FALLBACK))

    expect(events('lead_contact_clicked')).toEqual([
      { leadId: 9, surface: 'mobile', intendedChannel: 'whatsapp_native' },
    ])
    expect(events('lead_contact_succeeded')).toEqual([{ leadId: 9, surface: 'mobile', channel: 'whatsapp_native' }])
  })

  it('CF-4: rendering a blocked composer emits NOTHING — viewing is not intent', async () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={noInbound}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטה' />}
      />,
    )

    // A rep may open this thread from the inbox with no intention of writing.
    // A terminal contact event without a matching intent would inflate the
    // blocked count with passive reading and break the one-terminal-per-click
    // invariant the experiment is measured on.
    await waitFor(() => expect(screen.getByRole('link', FALLBACK)).toBeInTheDocument())
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('CF-5: no customer number → no anchor, and never a malformed wa.me', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={noInbound}
        facts={facts({ customerWaId: null })}
        textComposer={<textarea aria-label='טיוטה' />}
      />,
    )

    expect(screen.queryByRole('link', FALLBACK)).toBeNull()
    expect(document.querySelectorAll('a[href*="wa.me"]').length).toBe(0)
  })
})

describe('composer states that already work are untouched', () => {
  it('CF-6: OPEN window → the text composer, and NO fallback anchor', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundFresh}
        facts={facts()}
        textComposer={<textarea aria-label='טיוטה' />}
      />,
    )

    expect(screen.getByLabelText('טיוטה')).toBeInTheDocument()
    // The one path in the product that already works end to end. Adding a second
    // way out here would pull reps out of a conversation that is functioning.
    expect(document.querySelectorAll('a[href*="wa.me"]').length).toBe(0)
    expect(events('lead_contact_blocked')).toEqual([])
  })

  it('CF-7: CLOSED window WITH an approved template → template picker, no fallback', () => {
    render(
      <WhatsappComposerPanel
        leadId={9}
        messages={inboundStale}
        facts={facts({ templatesEnabled: true, templates: [approved] })}
        textComposer={<textarea aria-label='טיוטה' />}
      />,
    )

    expect(document.querySelectorAll('a[href*="wa.me"]').length).toBe(0)
    expect(events('lead_contact_blocked')).toEqual([])
  })
})
