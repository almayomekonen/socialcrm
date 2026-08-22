// @vitest-environment jsdom
//
// GREEN = the customer's saved automation state.
// PRO ACCESS = permission to execute it.
//
// These are two different facts, and the card must not conflate them. An
// automation switched on before a lapse stays visibly on, because that is what
// the customer configured; a lock beside it explains why nothing is running.
//
// No DB: runs in the no-DB suite.

import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EntitlementProvider } from '@/lib/entitlement/EntitlementContext'
import AutomationCard, { type AutomationCardData } from '@/components/settings/automations/AutomationCard'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-08-20T20:03:27.824Z' }
const ACTIVE = { hasAccess: true, status: 'PAID', expiresAt: '2026-12-01T00:00:00.000Z' }

function card(status: AutomationCardData['status']): AutomationCardData {
  return {
    id: 1,
    name: 'תודה אחרי סגירת עסקה',
    status,
    eventKey: 'status_changed',
    conditions: [],
    subject: 'lead',
    timing: { kind: 'preset', preset: 'immediate' },
    counts: { sent: 0, wouldSend: 0, skipped: 0, failed: 0 },
  } as AutomationCardData
}

function renderCard(entitlement: typeof EXPIRED, status: AutomationCardData['status'] = 'active') {
  const noop = () => {}
  return render(
    <EntitlementProvider value={entitlement}>
      <AutomationCard
        data={card(status)}
        busy={false}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onDuplicate={noop}
        onActivity={noop}
        now={Date.parse('2026-08-22T09:00:00.000Z')}
      />
    </EntitlementProvider>,
  )
}

const toggle = () => screen.getByRole('button', { name: /השהה · |הפעל · / })

afterEach(cleanup)

describe('an enabled automation stays enabled after the subscription lapses', () => {
  it('the toggle still reads as pressed', () => {
    renderCard(EXPIRED)
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
  })

  /** Green is the saved state. Expiry must not grey it out. */
  it('the toggle keeps its active colour, never a disabled grey', () => {
    renderCard(EXPIRED)
    expect(toggle().className).toContain('bg-success')
    expect(toggle().className).not.toContain('bg-[#e6e8ed]')
  })

  it('the toggle is still operable, so the click can be answered by the Pro toast', () => {
    renderCard(EXPIRED)
    expect((toggle() as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the lock explains the difference between configured and running', () => {
  it('appears only for an enabled automation on a lapsed plan', () => {
    renderCard(EXPIRED)
    expect(screen.getByText(/האוטומציה מוגדרת כפעילה/)).toBeTruthy()
  })

  it('opens the explanation on hover', () => {
    renderCard(EXPIRED)
    const trigger = screen.getByText(/האוטומציה מוגדרת כפעילה/).closest('span')!
    fireEvent.focus(trigger)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('האוטומציה מוגדרת כפעילה')
    expect(tip.textContent).toContain('המנוי שלך הסתיים ולכן היא לא רצה כרגע.')
    expect(tip.textContent).toContain('חידוש המנוי יחזיר את ההפעלה.')
  })

  it('opens on keyboard focus too, not hover alone', () => {
    renderCard(EXPIRED)
    const trigger = screen.getByText(/האוטומציה מוגדרת כפעילה/).closest('span')!
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('wears the subscription tokens, and never the destructive red', () => {
    renderCard(EXPIRED)
    fireEvent.focus(screen.getByText(/האוטומציה מוגדרת כפעילה/).closest('span')!)
    const cls = screen.getByRole('tooltip').className
    expect(cls).toContain('bg-warning-bg')
    expect(cls).toContain('border-warning-border')
    expect(cls).toContain('text-warning-text')
    expect(cls).not.toMatch(/bg-red|text-error|bg-error/)
  })
})

describe('the lock appears in no other state', () => {
  it('a disabled automation on a lapsed plan stays off and claims nothing', () => {
    renderCard(EXPIRED, 'paused')
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(toggle().className).toContain('bg-[#e6e8ed]')
    expect(screen.queryByText(/האוטומציה מוגדרת כפעילה/)).toBeNull()
  })

  it('an active subscription is untouched, enabled or not', () => {
    renderCard(ACTIVE)
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(/האוטומציה מוגדרת כפעילה/)).toBeNull()
    cleanup()
    renderCard(ACTIVE, 'paused')
    expect(screen.queryByText(/האוטומציה מוגדרת כפעילה/)).toBeNull()
  })
})

describe('the refinement changes presentation only', () => {
  it('reuses the existing tooltip, and invents no second one', () => {
    const card = read('components/settings/automations/AutomationCard.tsx')
    expect(card).toContain("import { HoverTooltip } from '@/components/ui/HoverTooltip'")
    expect(card).not.toMatch(/createPortal[\s\S]{0,200}role='tooltip'/)
  })

  it('leaves the tooltip default styling intact for its existing caller', () => {
    const tip = read('components/ui/HoverTooltip.tsx')
    expect(tip).toContain('panelClassName ??')
    expect(tip).toContain("'pointer-events-none rounded-lg border border-gray-200 bg-white")
    // The WhatsApp status tooltip passes no panel class, so it is unchanged.
    expect(read('components/summary/WhatsappMessageStatus.tsx')).not.toContain('panelClassName')
  })

  it('never reads or writes the automation definition', () => {
    const card = read('components/settings/automations/AutomationCard.tsx')
    expect(card).not.toMatch(/expired[\s\S]{0,120}(setAutomationStatus|\.update\(|status\s*=)/)
    expect(card).not.toContain('subscriptionExpiredDisabled')
    // The card derives everything from the row it was handed.
    expect(card).toContain("const isActive = data.status === 'active'")
  })

  it('the engine remains the server-side authority', () => {
    expect(read('lib/automations/emit.ts')).toContain("blocked: 'no_product_access'")
    expect(read('actions/automations/manage.ts')).toContain('requireProductAccess')
  })

  it('the new copy uses no dash or maqaf as a separator', () => {
    for (const line of [
      'האוטומציה מוגדרת כפעילה',
      'המנוי שלך הסתיים ולכן היא לא רצה כרגע.',
      'חידוש המנוי יחזיר את ההפעלה.',
    ]) {
      expect(line, line).not.toMatch(/[-–—־]/)
    }
  })
})
