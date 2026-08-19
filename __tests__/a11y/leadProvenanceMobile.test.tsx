// @vitest-environment jsdom
//
// Mobile lead-detail provenance card: identity per real source, desktop copy
// reused for auto-ingest Facebook/WhatsApp, no invented marketing copy,
// no empty metadata rows, wrapping Hebrew, RTL, 44px conversation CTA,
// no nested interactive targets.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={typeof href === 'string' ? href : ''} {...rest}>
      {children}
    </a>
  ),
}))

import { INBOUND_LEAD_COPY } from '@/lib/leads/inboundLeadCopy'
import { formatCaptureAt } from '@/lib/leads/inboundLeadContextData'
import LeadProvenanceCard from '@/modules/leads/mobile/LeadProvenanceCard'
import { buildMobileProvenanceModel, provenanceVisual } from '@/modules/leads/mobile/leadProvenanceModel'
import type { LeadProvenanceInput } from '@/modules/leads/mobile/leadProvenanceModel'

afterEach(cleanup)

const FB_COMPOSITE = 'facebook:1557473805865751'
const WA_COMPOSITE = 'whatsapp:wamid.HBgMOTcyNTM3NzM2NjM2FQIAEhgUM0FGMDBBNjZFNzA1RDA4Qzg5NjQA'
const IG_COMPOSITE = 'instagram:123'
const CF7 = 'contact_form_7:3:c1e76529-dddb-407a-b0a4-3110089b0da4'

function input(over: Partial<LeadProvenanceInput> & Pick<LeadProvenanceInput, 'leadSource' | 'sourceLabel' | 'sourceChannel'>): LeadProvenanceInput {
  return {
    createdAt: '2026-08-16T13:59:00.000Z',
    firstName: 'דנה',
    lastName: 'כהן',
    phone: '0541234567',
    email: 'd@example.com',
    ...over,
  }
}

function nestedInteractive(container: HTMLElement) {
  return Array.from(container.querySelectorAll('a, button')).filter((el) => {
    const outer = el.parentElement?.closest('a, button')
    return outer != null && outer !== el
  })
}

describe('buildMobileProvenanceModel — source identity', () => {
  it('1. Facebook webhook composite → Facebook identity + desktop auto copy', () => {
    const model = buildMobileProvenanceModel(
      input({ leadSource: FB_COMPOSITE, sourceLabel: 'Facebook', sourceChannel: 'facebook' }),
    )
    expect(model.visual).toBe('facebook')
    expect(model.headline).toBe(INBOUND_LEAD_COPY.facebookHeadline)
    expect(model.body).toBe(INBOUND_LEAD_COPY.facebookBody)
    expect(model.capturedLabels).toEqual(['שם', 'טלפון', 'אימייל'])
    expect(model.headline).not.toContain('Instagram')
    expect(model.headline).not.toContain('1557473805865751')
  })

  it('2. WhatsApp webhook composite → WhatsApp identity + desktop auto copy', () => {
    const model = buildMobileProvenanceModel(
      input({
        leadSource: WA_COMPOSITE,
        sourceLabel: 'WhatsApp',
        sourceChannel: 'whatsapp',
        conversationId: 42,
        preview: 'היי',
      }),
    )
    expect(model.visual).toBe('whatsapp')
    expect(model.headline).toBe(INBOUND_LEAD_COPY.whatsappHeadline)
    expect(model.body).toBe(INBOUND_LEAD_COPY.whatsappWithConversation)
    expect(model.conversationId).toBe(42)
    expect(model.preview).toBe('היי')
    expect(model.headline).not.toContain('wamid')
  })

  it('3. Manual source → manual identity, never Facebook/WhatsApp auto copy', () => {
    const model = buildMobileProvenanceModel(input({ leadSource: 'ידני', sourceLabel: 'ידני', sourceChannel: 'manual' }))
    expect(model.visual).toBe('manual')
    expect(model.headline).toBe('ידני')
    expect(model.body).toBeNull()
    expect(model.headline).not.toContain('Facebook')
    expect(model.headline).not.toContain('WhatsApp')
    expect(model.headline).not.toContain('אוטומטית')
  })

  it('4. Import source → import identity, never Facebook/Instagram', () => {
    const model = buildMobileProvenanceModel(input({ leadSource: 'ייבוא', sourceLabel: 'ייבוא', sourceChannel: null }))
    expect(model.visual).toBe('import')
    expect(model.headline).toBe('ייבוא')
    expect(model.body).toBeNull()
    expect(model.headline).not.toContain('Facebook')
    expect(model.headline).not.toContain('Instagram')
  })

  it('plain WhatsApp (create-form tag) is NOT auto-ingest copy', () => {
    const model = buildMobileProvenanceModel(
      input({ leadSource: 'WhatsApp', sourceLabel: 'WhatsApp', sourceChannel: 'whatsapp' }),
    )
    expect(model.visual).toBe('whatsapp')
    expect(model.headline).toBe('WhatsApp')
    expect(model.body).toBeNull()
    expect(model.headline).not.toContain('אוטומטית')
  })

  it('Instagram composite shows Instagram, never inferred from facebook:', () => {
    expect(provenanceVisual(IG_COMPOSITE, 'instagram', 'Instagram')).toBe('instagram')
    expect(provenanceVisual(FB_COMPOSITE, 'facebook', 'Facebook')).toBe('facebook')
    const ig = buildMobileProvenanceModel(
      input({ leadSource: IG_COMPOSITE, sourceLabel: 'Instagram', sourceChannel: 'instagram' }),
    )
    expect(ig.visual).toBe('instagram')
    expect(ig.headline).toBe('Instagram')
    expect(ig.body).toBeNull()
  })

  it('website / CF7 composite → אתר, never the plugin key', () => {
    const model = buildMobileProvenanceModel(input({ leadSource: CF7, sourceLabel: 'אתר', sourceChannel: 'website' }))
    expect(model.visual).toBe('website')
    expect(model.headline).toBe('אתר')
    expect(model.headline).not.toContain('contact_form_7')
    expect(model.headline).not.toContain('c1e76529')
  })
})

describe('buildMobileProvenanceModel — metadata', () => {
  it('5. existing captured-field metadata is displayed when present', () => {
    const model = buildMobileProvenanceModel(
      input({
        leadSource: FB_COMPOSITE,
        sourceLabel: 'Facebook',
        sourceChannel: 'facebook',
        firstName: 'דנה',
        lastName: 'כהן',
        phone: '054',
        email: 'a@b.com',
      }),
    )
    expect(model.capturedLabels).toEqual(['שם', 'טלפון', 'אימייל'])
    expect(model.capturedAt).toBeTruthy()
  })

  it('6. missing optional metadata does not create empty rows', () => {
    const model = buildMobileProvenanceModel(
      input({
        leadSource: FB_COMPOSITE,
        sourceLabel: 'Facebook',
        sourceChannel: 'facebook',
        firstName: 'ליד מפייסבוק',
        lastName: null,
        phone: null,
        email: '  ',
        createdAt: null,
      }),
    )
    expect(model.capturedLabels).toEqual([])
    expect(model.capturedAt).toBeNull()

    const { container } = render(<LeadProvenanceCard model={model} />)
    expect(screen.getByText(INBOUND_LEAD_COPY.facebookHeadline)).toBeTruthy()
    expect(container.textContent).not.toContain('נקלטו אוטומטית')
    expect(container.textContent).not.toContain('נקלט אצלך')
  })

  it('Facebook placeholder name does not count as a captured name', () => {
    const model = buildMobileProvenanceModel(
      input({
        leadSource: FB_COMPOSITE,
        sourceLabel: 'Facebook',
        sourceChannel: 'facebook',
        firstName: 'ליד מפייסבוק',
        lastName: '',
        phone: '054',
        email: null,
      }),
    )
    expect(model.capturedLabels).toEqual(['טלפון'])
  })
})

describe('LeadProvenanceCard — layout / a11y', () => {
  it('7. long Hebrew source text wraps (no truncate on the headline)', () => {
    const long = 'המלצה מהשכנים בבניין הישן ליד הפארק אחרי שיחה ארוכה מאוד'
    const model = buildMobileProvenanceModel(input({ leadSource: long, sourceLabel: long, sourceChannel: null }))
    const { container } = render(<LeadProvenanceCard model={model} />)
    const heading = container.querySelector('h2')!
    expect(heading.textContent).toBe(long)
    expect(heading.className).toContain('break-words')
    expect(heading.className).not.toContain('truncate')
  })

  it('8. RTL remains correct', () => {
    const model = buildMobileProvenanceModel(
      input({ leadSource: FB_COMPOSITE, sourceLabel: 'Facebook', sourceChannel: 'facebook' }),
    )
    const { container } = render(<LeadProvenanceCard model={model} />)
    expect(container.querySelector('[data-testid="lead-provenance-mobile"]')?.getAttribute('dir')).toBe('rtl')
  })

  it('9. conversation CTA is min-h-11 (≥44px class contract)', () => {
    const model = buildMobileProvenanceModel(
      input({
        leadSource: WA_COMPOSITE,
        sourceLabel: 'WhatsApp',
        sourceChannel: 'whatsapp',
        conversationId: 9,
      }),
    )
    render(<LeadProvenanceCard model={model} />)
    const cta = screen.getByRole('link', { name: INBOUND_LEAD_COPY.openConversation })
    expect(cta.className).toContain('min-h-11')
    expect(cta.getAttribute('href')).toBe('/inbox?conversation=9')
  })

  it('10. no nested interactive elements; informational card is not a link', () => {
    const fb = buildMobileProvenanceModel(
      input({ leadSource: FB_COMPOSITE, sourceLabel: 'Facebook', sourceChannel: 'facebook' }),
    )
    const { container: fbBox } = render(<LeadProvenanceCard model={fb} />)
    expect(fbBox.querySelector('a')).toBeNull()
    expect(fbBox.querySelector('button')).toBeNull()
    expect(nestedInteractive(fbBox)).toHaveLength(0)

    cleanup()
    const wa = buildMobileProvenanceModel(
      input({
        leadSource: WA_COMPOSITE,
        sourceLabel: 'WhatsApp',
        sourceChannel: 'whatsapp',
        conversationId: 3,
        preview: 'שלום',
      }),
    )
    const { container: waBox } = render(<LeadProvenanceCard model={wa} />)
    expect(waBox.querySelectorAll('a')).toHaveLength(1)
    expect(nestedInteractive(waBox)).toHaveLength(0)
    expect(waBox.querySelector('[data-testid="lead-provenance-mobile"]')?.tagName).toBe('SECTION')
  })

  it('WhatsApp visual uses WhatsApp green; Facebook uses Facebook blue', () => {
    const { container: fb } = render(
      <LeadProvenanceCard
        model={buildMobileProvenanceModel(
          input({ leadSource: FB_COMPOSITE, sourceLabel: 'Facebook', sourceChannel: 'facebook' }),
        )}
      />,
    )
    expect(fb.querySelector('[data-source-visual="facebook"]')).toBeTruthy()
    expect(fb.innerHTML).toContain('#1877F2')
    expect(fb.innerHTML).not.toContain('#25D366')

    cleanup()
    const { container: wa } = render(
      <LeadProvenanceCard
        model={buildMobileProvenanceModel(
          input({ leadSource: WA_COMPOSITE, sourceLabel: 'WhatsApp', sourceChannel: 'whatsapp' }),
        )}
      />,
    )
    expect(wa.querySelector('[data-source-visual="whatsapp"]')).toBeTruthy()
    expect(wa.innerHTML).toContain('#25D366')
  })

  it('does not look clickable when informational (no cursor-pointer / hover:bg on the card)', () => {
    const { container } = render(
      <LeadProvenanceCard
        model={buildMobileProvenanceModel(
          input({ leadSource: 'ידני', sourceLabel: 'ידני', sourceChannel: 'manual' }),
        )}
      />,
    )
    const card = container.querySelector('[data-testid="lead-provenance-mobile"]')!
    expect(card.className).not.toContain('cursor-pointer')
    expect(card.className).not.toContain('hover:bg')
  })
})

describe('formatCaptureAt', () => {
  it('formats SocialCRM capture time in Asia/Jerusalem, never the raw ISO', () => {
    const out = formatCaptureAt('2026-08-16T13:59:00.000Z')
    expect(out).toBeTruthy()
    expect(out).toContain('16')
    expect(out).toContain('2026')
    expect(out).not.toContain('T13:59')
    expect(formatCaptureAt(null)).toBeNull()
    expect(formatCaptureAt('not-a-date')).toBeNull()
  })
})
