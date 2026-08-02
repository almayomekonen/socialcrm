// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import AutomationCard, { type AutomationCardData } from '@/components/settings/automations/AutomationCard'
import ActivityLogModal, { type ActivityRow } from '@/components/settings/automations/ActivityLogModal'

// Accessibility + copy-honesty regression for the אוטומציות surface.
// Extends the closed a11y baseline; never weakens it.

afterEach(cleanup)

const card = (over: Partial<AutomationCardData> = {}): AutomationCardData => ({
  id: 1,
  name: 'אימייל פתיחה לליד חדש',
  status: 'active',
  trigger: 'lead_created',
  sourceFilter: 'facebook',
  targetStatus: null,
  subject: 'קיבלנו את הפנייה שלך',
  timing: { kind: 'preset', preset: 'immediate' },
  counts: { sent: 0, wouldSend: 0, skipped: 0, failed: 0 },
  ...over,
})

const noop = () => {}
const renderCard = (data: AutomationCardData) =>
  render(
    <AutomationCard data={data} onEdit={noop} onToggle={noop} onDuplicate={noop} onDelete={noop} onActivity={noop} />,
  )

describe('AutomationCard', () => {
  it('names every action in text — no icon-only controls', () => {
    renderCard(card())
    for (const label of ['השהה', 'ערוך', 'יומן פעילות', 'שכפל', 'מחק']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('states the automation as one readable sentence', () => {
    renderCard(card())
    expect(screen.getByText(/כשליד חדש נכנס מפייסבוק/)).toBeInTheDocument()
    expect(screen.getByText(/מיד/)).toBeInTheDocument()
  })

  it('shows no activity line at all when there is nothing to report', () => {
    const { container } = renderCard(card())
    expect(container.textContent).not.toMatch(/0 אימיילים|נשלחו 0/)
  })

  it('labels observation-mode activity as would-have-been, never as sent', () => {
    renderCard(card({ counts: { sent: 0, wouldSend: 4, skipped: 0, failed: 0 } }))
    expect(screen.getByText(/היו נשלחים/)).toBeInTheDocument()
    expect(screen.queryByText(/^נשלחו/)).not.toBeInTheDocument()
  })

  it('surfaces failures as דורש טיפול', () => {
    renderCard(card({ counts: { sent: 2, wouldSend: 0, skipped: 0, failed: 1 } }))
    expect(screen.getByText('דורש טיפול')).toBeInTheDocument()
  })

  it('offers the opposite toggle label for a paused automation', () => {
    renderCard(card({ status: 'paused' }))
    expect(screen.getByRole('button', { name: /הפעל/ })).toBeInTheDocument()
    expect(screen.getByText('מושהה')).toBeInTheDocument()
  })
})

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 1,
  leadId: 42,
  leadName: 'דנה לוי',
  kind: 'sent',
  mode: 'live',
  skipReason: null,
  subject: 'קיבלנו את הפנייה שלך',
  deliveryState: 'sent',
  occurredAt: '2026-08-02T09:00:00.000Z',
  ...over,
})

describe('ActivityLogModal', () => {
  it('is a labelled dialog', () => {
    render(<ActivityLogModal name='אימייל פתיחה' rows={[row()]} onClose={noop} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('empty state explains what happened and what will appear', () => {
    render(<ActivityLogModal name='אימייל פתיחה' rows={[]} onClose={noop} />)
    expect(screen.getByText('אין עדיין פעילות')).toBeInTheDocument()
    expect(screen.getByText(/כל שליחה וכל דילוג יופיעו כאן/)).toBeInTheDocument()
  })

  it('never claims delivery for a merely-accepted send', () => {
    render(<ActivityLogModal name='א' rows={[row()]} onClose={noop} />)
    expect(screen.getByText('נשלח')).toBeInTheDocument()
    expect(screen.queryByText('נמסר')).not.toBeInTheDocument()
  })

  it('labels observation rows with the ADR-009 copy, never "נשלח"', () => {
    render(<ActivityLogModal name='א' rows={[row({ kind: 'would_send', mode: 'log', deliveryState: null })]} onClose={noop} />)
    expect(screen.getByText('היה נשלח (מצב תצפית)')).toBeInTheDocument()
  })

  it('explains skips in human Hebrew rather than a code', () => {
    render(
      <ActivityLogModal
        name='א'
        rows={[row({ kind: 'skipped', skipReason: 'suppressed', deliveryState: null, subject: null })]}
        onClose={noop}
      />,
    )
    expect(screen.getByText('לא נשלח — הליד הוסר מרשימת התפוצה')).toBeInTheDocument()
  })
})
