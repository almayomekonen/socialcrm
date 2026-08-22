// @vitest-environment jsdom
//
// Mobile Leads: selection reconciled against the LIST.
//
// THE BUG. `reconcileAction()` keeps the open sheet honest against `ids`, but
// nothing kept `ids` honest against the rows. Changing a selected lead's status
// revalidates `/leads`; the lead can then leave this list — filtered out by an
// active status filter, or reordered past the loaded batch — while its id stayed
// selected. The bar went on reading "נבחרו 1" for a row that no longer existed,
// and `actionLead = items.find(...)` resolved to null, so `LeadListActionsSheet`
// (`open={open && lead != null}`) never opened: `פעולות` looked broken.
//
// The rule: drop ONLY orphaned ids. A still-visible lead stays selected, and in
// a multi-select the survivors keep theirs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/actions/clients', () => ({
  deleteManyLeads: vi.fn(async () => ({ deletedCount: 1, blockedCount: 0, blockedLeads: [] })),
  updateLead: vi.fn(async () => ({})),
}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn(async () => {}) }))
vi.mock('@/actions/leadFollowUp', () => ({
  setLeadFollowUp: vi.fn(async () => ({})),
  clearLeadFollowUp: vi.fn(async () => ({})),
}))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({
  openLeadWhatsappInInbox: vi.fn(async () => {}),
  WHATSAPP_CONNECT_HREF: '/settings/integrations?section=whatsapp',
}))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({
  useAccessDenied: () => false,
  useEntitlement: () => ({ status: 'ACTIVE', hasAccess: true, expiresAt: null }),
}))
vi.mock('@/actions/leads/loadMoreMobileLeads', () => ({ loadMoreMobileLeads: vi.fn(async () => ({ rows: [], hasMore: false, page: 2 })) }))

import LeadListMobileClient from '@/modules/leads/mobile/LeadListMobileClient'

const NOW = Date.UTC(2026, 7, 22, 9, 0, 0)
const card = (id: number) => ({
  id,
  name: `ליד ${id}`,
  phone: '0541234567',
  waPhone: '972541234567',
  email: null,
  status: 'new' as const,
  sourceLabel: 'ידני',
  sourceChannel: 'manual' as const,
  nextFollowUpAt: null,
  lastActivityAt: null,
  createdAt: null,
  nextAction: null,
  severity: null,
  isNewBadge: false,
  handlerName: null,
  recency: 'עכשיו',
  followUp: null,
})

const filters = { q: '', status: [] as never[] }

function view(cards: ReturnType<typeof card>[]) {
  return render(
    <LeadListMobileClient
      cards={cards as never}
      filters={filters as never}
      hasMore={false}
      page={1}
      nowMs={NOW}
      dayStartMs={NOW}
    />,
  )
}

const rerenderWith = (rerender: (ui: React.ReactElement) => void, cards: ReturnType<typeof card>[]) =>
  rerender(
    <LeadListMobileClient
      cards={cards as never}
      filters={filters as never}
      hasMore={false}
      page={1}
      nowMs={NOW}
      dayStartMs={NOW}
    />,
  )

/** Long-press enters selection; the row is the testid'd control. */
const longPress = (id: number) => {
  const row = document.querySelector(`[data-lead-id="${id}"]`)!
  fireEvent.pointerDown(row)
  fireEvent.mouseDown(row)
  vi.advanceTimersByTime(700)
  fireEvent.pointerUp(row)
  fireEvent.mouseUp(row)
}

const bar = () => screen.queryByText(/נבחרו/)

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('selection reconciles against the list', () => {
  it('SR-1: a selected lead that LEAVES the list is dropped — the bar disappears', async () => {
    const { rerender } = view([card(1), card(2)])
    longPress(1)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))

    // Status change revalidated /leads; lead 1 no longer matches the list.
    rerenderWith(rerender, [card(2)])

    await waitFor(() => expect(bar()).toBeNull())
  })

  it('SR-2: a selected lead that REMAINS visible stays selected', async () => {
    const { rerender } = view([card(1), card(2)])
    longPress(1)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))

    // Same ids, reordered + patched — selection must survive.
    rerenderWith(rerender, [{ ...card(2) }, { ...card(1), status: 'contacted' as never }])

    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))
  })

  it('SR-3: multi-select — one leaves, the survivors keep their selection', async () => {
    const { rerender } = view([card(1), card(2), card(3)])
    longPress(1)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))
    fireEvent.click(document.querySelector('[data-lead-id="2"]')!)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 2'))
    fireEvent.click(document.querySelector('[data-lead-id="3"]')!)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 3'))

    rerenderWith(rerender, [card(1), card(3)])

    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 2'))
  })

  it('SR-4: "פעולות" still opens for a lead that survived the mutation', async () => {
    const { rerender } = view([card(1), card(2)])
    longPress(1)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))

    rerenderWith(rerender, [{ ...card(1), status: 'contacted' as never }, card(2)])

    fireEvent.click(screen.getByRole('button', { name: /פעולות/ }))
    // The sheet is `open={open && lead != null}` — it renders only if the lead
    // is still resolvable in `items`. This is the dead-button regression guard.
    await waitFor(() => expect(screen.getByText('פעולות לליד')).toBeTruthy())
  })

  it('SR-5: an orphaned lead cannot leave a sheet bound to a missing row', async () => {
    const { rerender } = view([card(1), card(2)])
    longPress(1)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))
    fireEvent.click(screen.getByRole('button', { name: /פעולות/ }))
    await waitFor(() => expect(screen.getByText('פעולות לליד')).toBeTruthy())

    // Lead 1 leaves the list while its action sheet is open.
    rerenderWith(rerender, [card(2)])

    await waitFor(() => expect(screen.queryByText('פעולות לליד')).toBeNull())
    expect(bar()).toBeNull()
  })

  it('SR-6: an unchanged id set leaves selection untouched (no needless churn)', async () => {
    const { rerender } = view([card(1), card(2)])
    longPress(1)
    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))

    // Identical ids, fresh objects — selection must be preserved exactly.
    rerenderWith(rerender, [card(1), card(2)])

    await waitFor(() => expect(bar()?.textContent).toContain('נבחרו 1'))
  })

  it('SR-7: selection with NO ids is a no-op — nothing is rendered or reset', async () => {
    const { rerender } = view([card(1), card(2)])
    expect(bar()).toBeNull()
    rerenderWith(rerender, [card(2)])
    await waitFor(() => expect(bar()).toBeNull())
  })
})
