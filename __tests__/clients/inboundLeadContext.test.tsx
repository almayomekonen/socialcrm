// @vitest-environment jsdom
//
// Inbound-lead context surface — trigger logic (inboundChannelFromSource) +
// the pure presentational view. Pure client, no DB: run with VITEST_NO_DB=1.

import { afterEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

// next/link → plain anchor (no router context needed).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : ''} {...rest}>
      {children}
    </a>
  ),
}))

import { inboundChannelFromSource } from '@/lib/leads/leadSourceLabel'
import { InboundLeadContextView } from '@/components/clients/InboundLeadContextView'

afterEach(cleanup)

const WA_HEAD = 'הליד הזה הגיע אליך אוטומטית מ־WhatsApp'
const FB_HEAD = 'הליד הזה הגיע אליך אוטומטית מ־Facebook'
const WA_WITH_CONV = 'SocialCRM קלט את הליד והשיחה ברגע שהלקוח פנה אליך.'
const WA_NO_CONV = 'SocialCRM קלט את הליד ברגע שהלקוח פנה אליך.'
const FB_COPY = 'SocialCRM קלט את פרטי הליד אוטומטית מהמודעה שלך.'

describe('inboundChannelFromSource — trigger (composite webhook sources ONLY)', () => {
  it('whatsapp:/facebook:/instagram: composites → their channel; wamid/leadId never returned', () => {
    expect(inboundChannelFromSource('whatsapp:wamid.HBgMNTQ1gUM0FGMDBBNjZFNza1RDA4Qzg5NjQA')).toBe('whatsapp')
    expect(inboundChannelFromSource('facebook:123456789')).toBe('facebook')
    expect(inboundChannelFromSource('instagram:1')).toBe('instagram')
    // the return is the channel enum — never the external id
    expect(inboundChannelFromSource('whatsapp:wamid.X')).not.toContain('wamid')
  })

  it('plain/manual-declared and non-inbound values → null (no surface)', () => {
    for (const v of ['WhatsApp', 'whatsapp', 'Facebook', 'facebook', 'Instagram', 'manual', 'ידני', 'ייבוא', 'אתר', 'לירון אובודנקו', '', '   ', null, undefined]) {
      expect(inboundChannelFromSource(v as any)).toBeNull()
    }
  })

  it('never infers Instagram from facebook:*', () => {
    expect(inboundChannelFromSource('facebook:987')).toBe('facebook')
  })
})

describe('InboundLeadContextView — WhatsApp', () => {
  it('conversation + first-inbound message → copy, preview, and Inbox CTA to the right route', () => {
    render(<InboundLeadContextView channel='whatsapp' conversationId={42} preview='היי, אני מעוניין בפרטים' />)
    expect(screen.getByText(WA_HEAD)).toBeTruthy()
    expect(screen.getByText(WA_WITH_CONV)).toBeTruthy()
    expect(screen.getByText('היי, אני מעוניין בפרטים')).toBeTruthy()
    const cta = screen.getByText('פתח את השיחה').closest('a')!
    expect(cta.getAttribute('href')).toBe('/inbox?conversation=42')
  })

  it('renders message content as TEXT (never raw HTML)', () => {
    const { container } = render(
      <InboundLeadContextView channel='whatsapp' conversationId={7} preview={'<script>alert(1)</script> hi'} />,
    )
    // No script element injected; the literal characters are shown as text.
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>alert(1)</script> hi')).toBeTruthy()
  })

  it('long message is clamped (line-clamp), not allowed to grow the surface', () => {
    const long = 'א'.repeat(2000)
    render(<InboundLeadContextView channel='whatsapp' conversationId={1} preview={long} />)
    const previewEl = screen.getByText(long)
    expect(previewEl.className).toContain('line-clamp-2')
    expect(previewEl.getAttribute('dir')).toBe('auto')
  })

  it('conversation but NO usable message → copy + CTA, no preview', () => {
    const { container } = render(<InboundLeadContextView channel='whatsapp' conversationId={9} preview={null} />)
    expect(screen.getByText(WA_WITH_CONV)).toBeTruthy()
    expect(screen.getByText('פתח את השיחה').closest('a')!.getAttribute('href')).toBe('/inbox?conversation=9')
    // no preview box
    expect(container.querySelector('.line-clamp-2')).toBeNull()
  })

  it('NO conversation → graceful fallback copy, no CTA, no preview', () => {
    render(<InboundLeadContextView channel='whatsapp' conversationId={null} preview={null} />)
    expect(screen.getByText(WA_HEAD)).toBeTruthy()
    expect(screen.getByText(WA_NO_CONV)).toBeTruthy() // without "והשיחה"
    expect(screen.queryByText(WA_WITH_CONV)).toBeNull()
    expect(screen.queryByText('פתח את השיחה')).toBeNull()
  })

  it('never renders a raw wamid / composite source string', () => {
    const { container } = render(<InboundLeadContextView channel='whatsapp' conversationId={5} preview='שלום' />)
    expect(container.textContent).not.toContain('wamid')
    expect(container.textContent).not.toContain('whatsapp:')
  })
})

describe('InboundLeadContextView — Facebook', () => {
  it('renders Facebook copy only — no message preview, no Inbox CTA', () => {
    const { container } = render(<InboundLeadContextView channel='facebook' />)
    expect(screen.getByText(FB_HEAD)).toBeTruthy()
    expect(screen.getByText(FB_COPY)).toBeTruthy()
    expect(screen.queryByText('פתח את השיחה')).toBeNull()
    expect(container.querySelector('a[href^="/inbox"]')).toBeNull()
    expect(container.querySelector('.line-clamp-2')).toBeNull()
  })
})

describe('InboundLeadContextView — semantics', () => {
  it('uses a heading, is not role=status, and is not dismissible', () => {
    const { container } = render(<InboundLeadContextView channel='whatsapp' conversationId={1} preview='x' />)
    expect(container.querySelector('h2')).toBeTruthy()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(screen.queryByLabelText('סגירה')).toBeNull() // no close control
  })
})
