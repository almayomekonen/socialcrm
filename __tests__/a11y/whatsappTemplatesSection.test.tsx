// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const { listTemplates, countByStatus } = vi.hoisted(() => ({ listTemplates: vi.fn(), countByStatus: vi.fn() }))
vi.mock('@/db/whatsappTemplates', () => ({ listTemplates, countByStatus }))

import TemplateStatusBadge from '@/components/settings/templates/TemplateStatusBadge'
import TemplateRow from '@/components/settings/templates/TemplateRow'
import TemplateList from '@/components/settings/templates/TemplateList'
import TemplatesEmptyState from '@/components/settings/templates/TemplatesEmptyState'
import TemplateListSkeleton from '@/components/settings/templates/TemplateListSkeleton'
import TemplatesSection, { TemplatesBody, TemplatesHeaderBadge } from '@/components/settings/templates/TemplatesSection'
import type { Template } from '@/lib/whatsapp/templates/types'

afterEach(() => {
  cleanup()
  listTemplates.mockReset()
  countByStatus.mockReset()
})

const tpl = (id: number, status: Template['status'], displayTitle = 'הודעה'): Template => ({
  id,
  displayTitle,
  status,
  bodyText: 'תוכן כלשהו',
  variables: [],
  failureText: status === 'rejected' ? 'ההודעה לא אושרה. נסו שוב.' : null,
  archived: false,
  createdAt: '2026-07-23T10:00:00.000Z',
})

describe('TemplateStatusBadge', () => {
  it('shows a Hebrew label per status, no Meta terms', () => {
    for (const [status, label] of [
      ['approved', 'מוכנה לשליחה'],
      ['pending', 'בבדיקת וואטסאפ'],
      ['rejected', 'נדחתה'],
    ] as const) {
      render(<TemplateStatusBadge status={status} />)
      const el = screen.getByText(label)
      expect(el).toBeInTheDocument()
      expect(el.textContent).not.toMatch(/[A-Z]{4,}/)
      cleanup()
    }
  })
})

describe('TemplateRow', () => {
  it('renders title, preview, and status badge', () => {
    render(<TemplateRow template={tpl(1, 'approved', 'תזכורת פולואפ')} />)
    expect(screen.getByText('תזכורת פולואפ')).toBeInTheDocument()
    expect(screen.getByText('תוכן כלשהו')).toBeInTheDocument()
    expect(screen.getByText('מוכנה לשליחה')).toBeInTheDocument()
  })

  it('a pending row shows the calm WhatsApp-review helper (Tier 2)', () => {
    render(<TemplateRow template={tpl(1, 'pending', 'תזכורת')} />)
    expect(screen.getByText('בבדיקת וואטסאפ')).toBeInTheDocument() // badge
    expect(screen.getByText('ההודעה נשלחה לאישור וואטסאפ')).toBeInTheDocument()
    expect(screen.getByText(/אין צורך לעשות דבר/)).toBeInTheDocument()
  })
})

describe('TemplateList — sort (rejected → pending → approved)', () => {
  it('floats rejected to the top', () => {
    render(
      <TemplateList
        templates={[tpl(1, 'approved', 'A'), tpl(2, 'rejected', 'R'), tpl(3, 'pending', 'P')]}
      />,
    )
    const titles = screen.getAllByText(/^[ARP]$/).map((n) => n.textContent)
    expect(titles).toEqual(['R', 'P', 'A'])
  })
  it('has an accessible list label', () => {
    render(<TemplateList templates={[tpl(1, 'approved')]} />)
    expect(screen.getByRole('list', { name: 'הודעות WhatsApp מוכנות' })).toBeInTheDocument()
  })
})

describe('TemplatesEmptyState', () => {
  it('answers what / why / next with an (inert) CTA', () => {
    render(<TemplatesEmptyState />)
    expect(screen.getByText('אין עדיין הודעות WhatsApp מוכנות')).toBeInTheDocument()
    // CTA present as a button (Sprint 2: no navigation, inert by design)
    const cta = screen.getByRole('button', { name: /צור הודעה מוכנה/ })
    expect(cta).toBeInTheDocument()
    expect(cta).not.toHaveAttribute('href')
    // the quiet automation opportunity line
    expect(screen.getByText(/מענה אוטומטי/)).toBeInTheDocument()
  })
})

describe('TemplateListSkeleton', () => {
  it('is decorative (aria-hidden) and content-shaped', () => {
    render(<TemplateListSkeleton />)
    const sk = screen.getByTestId('templates-skeleton')
    expect(sk).toHaveAttribute('aria-hidden', 'true')
    expect(sk.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0)
  })
})

describe('TemplatesSection — connection gating (one state at a time)', () => {
  it('not connected → connect-first notice + link to the WhatsApp section', () => {
    render(TemplatesSection({ agencyId: 103, connected: false, messagingReady: false }))
    expect(screen.getByText('צריך לחבר וואטסאפ עסקי')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'למעבר לחיבור וואטסאפ' })
    expect(link).toHaveAttribute('href', '/settings/integrations?section=whatsapp')
    expect(screen.queryByText('אין עדיין הודעות WhatsApp מוכנות')).toBeNull()
    expect(listTemplates).not.toHaveBeenCalled()
  })

  it('connected but not ready → not-ready notice', () => {
    render(TemplatesSection({ agencyId: 103, connected: true, messagingReady: false }))
    expect(screen.getByText('חיבור הוואטסאפ עדיין לא מוכן')).toBeInTheDocument()
    expect(listTemplates).not.toHaveBeenCalled()
  })

  it('connected + ready → the list region loads behind the skeleton', () => {
    render(TemplatesSection({ agencyId: 103, connected: true, messagingReady: true }))
    // Suspense fallback (the loading state) renders synchronously.
    expect(screen.getByTestId('templates-skeleton')).toBeInTheDocument()
  })
})

describe('TemplatesBody — resolved states', () => {
  it('empty → the empty state', async () => {
    listTemplates.mockResolvedValue([])
    render(await TemplatesBody({ agencyId: 103 }))
    expect(screen.getByText('אין עדיין הודעות WhatsApp מוכנות')).toBeInTheDocument()
    expect(listTemplates).toHaveBeenCalledWith(103)
  })

  it('has templates → the list', async () => {
    listTemplates.mockResolvedValue([tpl(1, 'approved', 'תזכורת')])
    render(await TemplatesBody({ agencyId: 103 }))
    expect(screen.getByRole('list', { name: 'הודעות WhatsApp מוכנות' })).toBeInTheDocument()
    expect(screen.getByText('תזכורת')).toBeInTheDocument()
  })
})

describe('TemplatesHeaderBadge', () => {
  it('renders nothing when not connected (no query)', async () => {
    const el = await TemplatesHeaderBadge({ agencyId: 103, connected: false })
    expect(el).toBeNull()
    expect(countByStatus).not.toHaveBeenCalled()
  })

  it('shows an approved count when there are approved messages', async () => {
    countByStatus.mockResolvedValue({ approved: 3, pending: 1 })
    render(await TemplatesHeaderBadge({ agencyId: 103, connected: true }))
    expect(screen.getByText('3 מוכנות')).toBeInTheDocument()
  })

  it('shows the pending count when only pending exist', async () => {
    countByStatus.mockResolvedValue({ pending: 2 })
    render(await TemplatesHeaderBadge({ agencyId: 103, connected: true }))
    expect(screen.getByText('2 בבדיקה')).toBeInTheDocument()
  })

  it('renders nothing when there is nothing to advertise', async () => {
    countByStatus.mockResolvedValue({})
    const el = await TemplatesHeaderBadge({ agencyId: 103, connected: true })
    expect(el).toBeNull()
  })
})
