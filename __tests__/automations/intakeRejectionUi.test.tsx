// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import IntegrationConnectionCard from '@/components/settings/connections/IntegrationConnectionCard'
import LeadIntakeBanner from '@/components/clients/LeadIntakeBanner'
import MetaDisconnectedBanner from '@/components/clients/MetaDisconnectedBanner'
import { DELIVERY } from '@/components/settings/connections/copy'
import { INTAKE_ERRORS, intakeErrorCopy, isFailingIntake } from '@/lib/automations/connectors/intakeErrors'
import { deliveryStateOf } from '@/lib/automations/connectors/overview'
import type { IntegrationView } from '@/lib/automations/connectors/overview'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/actions/automations/connections', () => ({
  connectionSetup: vi.fn(async () => ({ ok: true })),
  regenerateSecret: vi.fn(async () => ({ ok: true })),
  renameSource: vi.fn(async () => ({ ok: true })),
  revokeConnection: vi.fn(async () => ({ ok: true })),
  provisionApiKeyConnection: vi.fn(async () => ({ ok: true })),
}))

/**
 * WHAT THE CUSTOMER SEES when a lead source is refusing what arrives.
 *
 * The fixtures are the same Zeta Desk integration `connectionsPage.test.tsx`
 * uses, so "healthy is unchanged" is asserted against the identical shape.
 */

afterEach(cleanup)

const view = (over: Partial<IntegrationView> = {}): IntegrationView => ({
  integration: { key: 'zeta_desk', title: 'Zeta Desk', icon: 'headset', auth: 'api_key', capabilities: ['zeta_connected'] },
  unlocks: [{ key: 'ticket.opened', title: 'נפתחה פנייה' }],
  connections: [],
  connected: false,
  needsAttention: false,
  ...over,
})

const connection = (over: Partial<IntegrationView['connections'][number]> = {}) => ({
  id: 'zeta_desk:1',
  displayName: 'הדסק הראשי',
  health: 'ok' as const,
  sources: [{ id: 'q_1', label: 'תור תמיכה', subscription: 'subscribed' as const, health: 'ok' as const }],
  automations: 3,
  lastActivityAt: null,
  lastEventAt: '2026-08-09T10:00:00.000Z',
  eventCount: 12,
  lastRejectedAt: null,
  consecutiveRejections: 0,
  lastRejectionReason: null,
  delivery: 'receiving' as const,
  reportsDelivery: true,
  ...over,
})

/**
 * Production connection #3 verbatim: 57 verified deliveries, then ONE
 * `invalid_signature` six days later. Deliberately a single refusal — the
 * regression case that used to render "מקבל אירועים".
 */
const rejecting = () =>
  connection({
    delivery: 'rejected' as const,
    eventCount: 57,
    lastEventAt: '2026-08-04T16:42:28.956Z',
    lastRejectedAt: '2026-08-10T07:34:26.653Z',
    consecutiveRejections: 1,
    lastRejectionReason: 'invalid_signature',
  })

const noop = () => {}

// ── 5, 11: the connection card ──────────────────────────────────────────────

describe('the connection card in the rejected state', () => {
  it('says פניות נדחות instead of מקבל אירועים', () => {
    render(<IntegrationConnectionCard view={view({ connections: [rejecting()], connected: true })} onChanged={noop} />)
    expect(screen.getAllByText(DELIVERY.rejected.label).length).toBeGreaterThan(0)
    expect(screen.queryByText(DELIVERY.receiving.label)).not.toBeInTheDocument()
  })

  it('explains it in the customer’s terms, as an alert', () => {
    render(<IntegrationConnectionCard view={view({ connections: [rejecting()], connected: true })} onChanged={noop} />)
    const copy = intakeErrorCopy('invalid_signature')!
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(copy.title)
    expect(alert).toHaveTextContent(copy.explanation)
  })

  it('NEVER prints the technical reason it is holding', () => {
    const { container } = render(
      <IntegrationConnectionCard view={view({ connections: [rejecting()], connected: true })} onChanged={noop} />,
    )
    // The card has `lastRejectionReason: 'invalid_signature'` in its props and
    // must not leak a character of it — nor any of its neighbours.
    for (const term of ['invalid_signature', 'signature', 'HMAC', 'webhook', '401', 'Error', 'undefined']) {
      expect(container.textContent, term).not.toContain(term)
    }
  })

  /**
   * The alert block carries NO button. `בדיקת החיבור` used to sit here and only
   * navigated to the page the card is already on — a self-link beside `פרטים`,
   * the control that actually opens the repair flow.
   */
  it('offers no CTA of its own, leaving פרטים as the real action', () => {
    render(<IntegrationConnectionCard view={view({ connections: [rejecting()], connected: true })} onChanged={noop} />)
    const alert = screen.getByRole('alert')
    expect(alert.querySelector('a')).toBeNull()
    expect(alert.querySelector('button')).toBeNull()
    expect(screen.queryByText('בדיקת החיבור')).not.toBeInTheDocument()
    // The card's own actions are untouched — this is what the customer presses.
    expect(screen.getByRole('button', { name: 'פרטים' })).toBeInTheDocument()
  })

  it('renders nothing extra for a reason with no customer copy', () => {
    // Belt and braces: `deliveryStateOf` cannot produce `rejected` for these,
    // but if it ever did the card stays quiet rather than rendering a blank box.
    render(
      <IntegrationConnectionCard
        view={view({ connections: [connection({ delivery: 'rejected' as const, lastRejectionReason: 'not_actionable' })], connected: true })}
        onChanged={noop}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ── 14: the regression guard ────────────────────────────────────────────────

describe('a healthy connection is untouched by any of this', () => {
  it('still reads as receiving, with no alert', () => {
    render(<IntegrationConnectionCard view={view({ connections: [connection()], connected: true })} onChanged={noop} />)
    expect(screen.getAllByText(DELIVERY.receiving.label).length).toBeGreaterThan(0)
    expect(screen.queryByText(DELIVERY.rejected.label)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('every delivery state still has its own Hebrew', () => {
    // The `Record<DeliveryState, …>` is what makes adding a state a compile
    // error rather than a blank chip; `rejected` joining it changed nothing else.
    for (const state of ['disconnected', 'never_received', 'receiving', 'unknown', 'rejected'] as const) {
      expect(DELIVERY[state].label.trim().length, state).toBeGreaterThan(0)
    }
    // `receiving` alone has no hint — there is nothing to explain when it works.
    expect(DELIVERY.receiving.hint).toBe('')
    expect(DELIVERY.rejected.role).toBe('error')
    expect(DELIVERY.rejected.hint.trim().length).toBeGreaterThan(0)
  })
})

// ── 7, 8, 11: the leads-page banner ─────────────────────────────────────────

const alert = () => ({
  connectionId: 'zeta_desk:1',
  title: INTAKE_ERRORS.invalid_signature!.title,
  short: INTAKE_ERRORS.invalid_signature!.short,
  action: INTAKE_ERRORS.invalid_signature!.action,
})

describe('the leads page banner', () => {
  it('says nothing when nothing is wrong', () => {
    const { container } = render(<LeadIntakeBanner alerts={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('states the problem and the consequence — and nothing it cannot deliver', () => {
    render(<LeadIntakeBanner alerts={[alert()]} />)
    expect(screen.getByText(alert().title)).toBeInTheDocument()
    expect(screen.getByText(alert().short)).toBeInTheDocument()
    // No button: the title already names the surface, and the only destination
    // we had is gated to ADMIN while this banner is not.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('בדיקת החיבור')).not.toBeInTheDocument()
  })

  it('announces politely rather than interrupting', () => {
    render(<LeadIntakeBanner alerts={[alert()]} />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('shows ONE problem, not a pile', () => {
    render(<LeadIntakeBanner alerts={[alert(), { ...alert(), connectionId: 'zeta_desk:2', title: 'שני' }]} />)
    expect(screen.queryByText('שני')).not.toBeInTheDocument()
  })

  it('leaks no technical term', () => {
    const { container } = render(<LeadIntakeBanner alerts={[alert()]} />)
    for (const term of ['invalid_signature', 'signature', 'webhook', 'HMAC', '401', 'zeta_desk:1']) {
      expect(container.textContent, term).not.toContain(term)
    }
  })
})

// ── 7, 8: the production regression, end to end ─────────────────────────────

describe('the confirmed production regression (connection #3)', () => {
  // The row exactly as production held it, fed through the real state machine
  // rather than handed a `delivery` prop — so the derivation is what is tested.
  const PROD_ROW = {
    eventCount: 57,
    consecutiveRejections: 1,
    lastRejectedAt: '2026-08-10T07:34:26.653Z',
    lastEventAt: '2026-08-04T16:42:28.956Z',
    lastRejectionReason: 'invalid_signature',
  }

  it('(8) the card does NOT say מקבל אירועים', () => {
    const derived = connection({ ...PROD_ROW, delivery: deliveryStateOf('ok', true, PROD_ROW) })
    expect(derived.delivery).toBe('rejected')
    render(<IntegrationConnectionCard view={view({ connections: [derived], connected: true })} onChanged={noop} />)
    expect(screen.queryByText(DELIVERY.receiving.label)).not.toBeInTheDocument()
    expect(screen.getAllByText(DELIVERY.rejected.label).length).toBeGreaterThan(0)
  })

  it('(7) the leads banner appears, with the required copy and no CTA', () => {
    expect(isFailingIntake(PROD_ROW)).toBe(true)
    const copy = intakeErrorCopy(PROD_ROW.lastRejectionReason)!
    render(<LeadIntakeBanner alerts={[{ connectionId: 'contact_form_7:3', title: copy.title, short: copy.short, action: copy.action }]} />)
    expect(screen.getByText('יש בעיה בחיבור לטופס באתר')).toBeInTheDocument()
    expect(screen.getByText('פניות מהטופס מגיעות אבל לא נכנסות למערכת.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('(5) one verified delivery puts it straight back to מקבל אירועים', () => {
    // recordDelivery stamps lastEventAt, bumps the count and zeroes the streak.
    const recovered = { ...PROD_ROW, eventCount: 58, lastEventAt: '2026-08-10T09:00:00.000Z', consecutiveRejections: 0, lastRejectionReason: null }
    expect(deliveryStateOf('ok', true, recovered)).toBe('receiving')
    render(
      <IntegrationConnectionCard
        view={view({ connections: [connection({ ...recovered, delivery: 'receiving' as const })], connected: true })}
        onChanged={noop}
      />,
    )
    expect(screen.getAllByText(DELIVERY.receiving.label).length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ── 15: the banner that was already there ───────────────────────────────────

describe('MetaDisconnectedBanner is exactly as it was', () => {
  it('renders nothing when not shown', () => {
    const { container } = render(<MetaDisconnectedBanner show={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps its own sentence and its own destination', () => {
    render(<MetaDisconnectedBanner show />)
    expect(screen.getByText('חשבון ה‑Meta מנותק. לידים חדשים לא ייכנסו עד שתחבר אותו מחדש.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'חבר מחדש' })).toHaveAttribute(
      'href',
      '/settings/integrations?section=facebook',
    )
  })

  it('the two banners coexist without either speaking for the other', () => {
    render(
      <div>
        <MetaDisconnectedBanner show />
        <LeadIntakeBanner alerts={[alert()]} />
      </div>,
    )
    // Meta keeps its CTA — its label promises navigation and its destination is
    // ungated, so it delivers. The intake banner has none, and the two sitting
    // side by side must not blur into one another.
    expect(screen.getByText('יש בעיה בחיבור לטופס באתר')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'חבר מחדש' })).toBeInTheDocument()
  })
})
