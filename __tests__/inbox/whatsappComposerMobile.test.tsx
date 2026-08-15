// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SERVICE_WINDOW_COPY } from '@/lib/inbox/whatsappComposerDecision'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply: vi.fn() }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn() }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import ConversationThreadMobile from '@/modules/inbox/mobile/ConversationThreadMobile'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => cleanup())

const inboundClosed = [
  {
    id: 1,
    direction: 'inbound' as const,
    type: 'text' as const,
    text: 'היי',
    timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    status: 'received' as const,
    failureText: null,
    failureCategory: null,
  },
]

describe('mobile composer — shared window/health decision', () => {
  it('R — source uses the shared helpers and does not duplicate 24h window math', () => {
    const src = readFileSync(join(process.cwd(), 'modules/inbox/mobile/ConversationThreadMobile.tsx'), 'utf8')
    expect(src).toContain("from '@/components/inbox/WhatsappComposerPanel'")
    expect(src).not.toMatch(/24\s*\*\s*60\s*\*\s*60/)
    expect(src).not.toContain('resolveWhatsappServiceWindow')
  })

  it('R — CLOSED + operational + approved template shows the same picker, not free-text', () => {
    render(
      <ConversationThreadMobile
        conversationId={44}
        leadId={9}
        displayName='דוד'
        initialMessages={inboundClosed}
        composerFacts={{
          health: 'operational',
          templatesEnabled: true,
          templates: [
            {
              id: 7,
              displayTitle: 'תזכורת',
              status: 'approved',
              bodyText: 'היי',
              variables: [],
              failureText: null,
              archived: false,
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          canManageTemplates: false,
        }}
      />,
    )
    expect(screen.queryByLabelText('כתיבת הודעה')).toBeNull()
    expect(screen.getByRole('button', { name: SERVICE_WINDOW_COPY.closedCta })).toBeInTheDocument()
  })
})
