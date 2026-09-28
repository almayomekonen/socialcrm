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
const FB_COPY = 'הלקוח מילא את הטופס שלך, ו־SocialCRM קלט את הפרטים עבורך אוטומטית.'

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
  it('renders the enhanced Facebook card: correct heading + supporting copy, no preview, no CTA', () => {
    const { container } = render(<InboundLeadContextView channel='facebook' hasName hasPhone hasEmail capturedAt='27/07/2026, 14:32' />)
    expect(screen.getByText(FB_HEAD)).toBeTruthy()
    expect(screen.getByText(FB_COPY)).toBeTruthy()
    // no WhatsApp-style message preview or Inbox CTA on Facebook
    expect(screen.queryByText('פתח את השיחה')).toBeNull()
    expect(container.querySelector('a[href^="/inbox"]')).toBeNull()
    expect(container.querySelector('a')).toBeNull() // no CTA / link at all
    expect(container.querySelector('.line-clamp-2')).toBeNull()
  })

  it('name+phone+email → all three evidence labels', () => {
    render(<InboundLeadContextView channel='facebook' hasName hasPhone hasEmail capturedAt='27/07/2026, 14:32' />)
    expect(screen.getByText('נקלטו אוטומטית: שם · טלפון · אימייל')).toBeTruthy()
  })

  it('name+phone (missing email) → email label absent', () => {
    render(<InboundLeadContextView channel='facebook' hasName hasPhone hasEmail={false} capturedAt='27/07/2026, 14:32' />)
    expect(screen.getByText('נקלטו אוטומטית: שם · טלפון')).toBeTruthy()
    expect(screen.queryByText(/אימייל/)).toBeNull()
  })

  it('name+email (missing phone) → phone label absent', () => {
    render(<InboundLeadContextView channel='facebook' hasName hasPhone={false} hasEmail capturedAt='27/07/2026, 14:32' />)
    expect(screen.getByText('נקלטו אוטומטית: שם · אימייל')).toBeTruthy()
    expect(screen.queryByText(/טלפון/)).toBeNull()
  })

  it('name only → only the name label', () => {
    render(<InboundLeadContextView channel='facebook' hasName hasPhone={false} hasEmail={false} capturedAt='27/07/2026, 14:32' />)
    expect(screen.getByText('נקלטו אוטומטית: שם')).toBeTruthy()
    expect(screen.queryByText(/טלפון/)).toBeNull()
    expect(screen.queryByText(/אימייל/)).toBeNull()
  })

  it('renders the capture time with "נקלט אצלך" semantics — never Meta submission wording', () => {
    const { container } = render(<InboundLeadContextView channel='facebook' hasName hasPhone hasEmail capturedAt='27/07/2026, 14:32' />)
    expect(screen.getByText('נקלט אצלך ב־27/07/2026, 14:32')).toBeTruthy()
    // must NOT overstate provenance as Meta's original submission
    const txt = container.textContent || ''
    expect(txt).not.toContain('נשלח')
    expect(txt).not.toContain('מילא את הטופס ב') // no "filled the form at <time>"
    expect(txt).not.toContain('created_time')
  })

  it('no captured fields and no capture time → evidence block omitted (copy still shows)', () => {
    render(<InboundLeadContextView channel='facebook' hasName={false} hasPhone={false} hasEmail={false} capturedAt={null} />)
    expect(screen.getByText(FB_HEAD)).toBeTruthy()
    expect(screen.getByText(FB_COPY)).toBeTruthy()
    expect(screen.queryByText(/נקלטו אוטומטית/)).toBeNull()
    expect(screen.queryByText(/נקלט אצלך/)).toBeNull()
  })

  it('never renders Page / campaign / ad / form attribution or any raw identifier', () => {
    const { container } = render(<InboundLeadContextView channel='facebook' hasName hasPhone hasEmail capturedAt='27/07/2026, 14:32' />)
    const txt = container.textContent || ''
    for (const forbidden of ['עמוד', 'קמפיין', 'מודעה:', 'טופס:', 'facebook:', 'page_id', 'leadgen', 'campaign', 'form_id', 'ad_id']) {
      expect(txt).not.toContain(forbidden)
    }
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

describe('InboundLeadContextView — Lead Ads form answers', () => {
  const answers = [
    { label: 'עיר', values: ['חיפה'] },
    { label: 'אילו שירותים מעניינים אותך?', values: ['צילום', 'וידאו'] },
    { label: 'הערות', values: [] },
  ]

  it('shows each question with its answer(s), and marks an empty one', () => {
    render(<InboundLeadContextView channel='facebook' hasName hasPhone formAnswers={answers} />)
    expect(screen.getByText('תשובות מהטופס')).toBeTruthy()
    expect(screen.getByText('עיר')).toBeTruthy()
    expect(screen.getByText('חיפה')).toBeTruthy()
    expect(screen.getByText('צילום · וידאו')).toBeTruthy()
    expect(screen.getByText('לא נענה')).toBeTruthy()
  })

  it('renders the customer’s answer as TEXT, never markup', () => {
    const { container } = render(
      <InboundLeadContextView channel='facebook' formAnswers={[{ label: 'q', values: ['<img src=x onerror=alert(1)>'] }]} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  })

  it('no answers → no answers block (older leads, or a form with only contact fields)', () => {
    render(<InboundLeadContextView channel='facebook' hasName formAnswers={[]} />)
    expect(screen.queryByText('תשובות מהטופס')).toBeNull()
  })

  it('an Instagram form gets the same card, headed Instagram', () => {
    render(<InboundLeadContextView channel='instagram' hasName formAnswers={answers} />)
    expect(screen.getByText('הליד הזה הגיע אליך אוטומטית מ־Instagram')).toBeTruthy()
    expect(screen.getByText('חיפה')).toBeTruthy()
  })
})
