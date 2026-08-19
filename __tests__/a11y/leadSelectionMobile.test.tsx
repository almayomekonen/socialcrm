// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const H = vi.hoisted(() => ({
  deleteManyLeads: vi.fn(),
  updateLead: vi.fn(),
  setLeadFollowUp: vi.fn(),
  openLeadWhatsappInInbox: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: H.refresh, back: vi.fn() }),
  usePathname: () => '/leads',
}))
vi.mock('@/actions/clients', () => ({
  deleteManyLeads: H.deleteManyLeads,
  updateLead: H.updateLead,
  deleteLead: vi.fn(),
}))
vi.mock('@/actions/leadFollowUp', () => ({
  setLeadFollowUp: H.setLeadFollowUp,
  clearLeadFollowUp: vi.fn(),
}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async () => {}),
}))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({
  openLeadWhatsappInInbox: H.openLeadWhatsappInInbox,
}))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))

import LeadListMobile from '@/modules/leads/mobile/LeadListMobile'
import type { MobileLeadRow } from '@/modules/leads/queries'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  H.deleteManyLeads.mockResolvedValue({ deletedCount: 1, blockedCount: 0, blockedLeads: [], reason: null })
  H.updateLead.mockResolvedValue({})
  H.setLeadFollowUp.mockResolvedValue({})
  H.openLeadWhatsappInInbox.mockResolvedValue(undefined)
})

const row = (over: Partial<MobileLeadRow> = {}): MobileLeadRow => ({
  id: 1,
  name: 'דני לוי',
  phone: '0541234567',
  waPhone: '972541234567',
  email: 'd@example.com',
  status: 'new',
  sourceLabel: 'WhatsApp',
  sourceChannel: 'whatsapp',
  nextFollowUpAt: null,
  lastActivityAt: null,
  createdAt: null,
  nextAction: 'התקשר עכשיו',
  severity: null,
  isNewBadge: true,
  handlerName: null,
  ...over,
})

function renderList(rows: MobileLeadRow[] = [row(), row({ id: 2, name: 'נועה כהן', isNewBadge: false })]) {
  return render(
    <LeadListMobile
      rows={rows}
      filters={{ q: '', status: [] }}
      hasMore={false}
      page={1}
      workspaceEmpty={false}
      nowMs={Date.parse('2026-08-13T12:00:00+03:00')}
    />,
  )
}

function enterSelection(el: Element) {
  fireEvent.contextMenu(el)
}

function tap(el: Element) {
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.click(el)
}

describe('mobile lead selection', () => {
  it('a normal tap target is a link to lead detail', () => {
    renderList([row()])
    expect(screen.getByTestId('lead-row').getAttribute('href')).toBe('/clients/1/summary')
    expect(screen.queryByTestId('leads-selection-bar')).toBeNull()
  })

  it('long press / context menu enters selection and never deletes', () => {
    renderList([row()])
    enterSelection(screen.getByTestId('lead-row'))
    expect(screen.getByTestId('leads-selection-bar').textContent).toContain('נבחרו 1')
    expect(H.deleteManyLeads).not.toHaveBeenCalled()
    const selected = screen.getByRole('link', { name: /דני לוי/ })
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.getAttribute('href')).toBe('/clients/1/summary')
  })

  it('contact actions are siblings — context menu on WhatsApp does not select', () => {
    renderList([row()])
    fireEvent.contextMenu(screen.getByRole('button', { name: /וואטסאפ/ }))
    expect(screen.queryByTestId('leads-selection-bar')).toBeNull()
  })

  it('second tap on the selected lead deselects and exits selection', () => {
    renderList([row()])
    enterSelection(screen.getByTestId('lead-row'))
    tap(screen.getByTestId('lead-row'))
    expect(screen.queryByTestId('leads-selection-bar')).toBeNull()
    expect(screen.getByTestId('lead-row').getAttribute('href')).toBe('/clients/1/summary')
  })

  it('toggles a second row and cancel leaves the list unmutated', () => {
    renderList()
    enterSelection(screen.getAllByTestId('lead-row')[0])
    tap(screen.getAllByTestId('lead-row')[1])
    expect(screen.getByTestId('leads-selection-bar').textContent).toContain('נבחרו 2')
    fireEvent.click(screen.getAllByRole('button', { name: 'ביטול' })[0])
    expect(screen.queryByTestId('leads-selection-bar')).toBeNull()
    expect(H.deleteManyLeads).not.toHaveBeenCalled()
  })

  it('select → פעולות → tap same item closes the action sheet and clears context', () => {
    renderList([row()])
    enterSelection(screen.getByTestId('lead-row'))
    fireEvent.click(screen.getByRole('button', { name: 'פעולות' }))
    expect(screen.getByRole('dialog', { name: 'פעולות לליד' })).toBeTruthy()
    tap(screen.getByTestId('lead-row'))
    expect(screen.queryByRole('dialog', { name: 'פעולות לליד' })).toBeNull()
    expect(screen.queryByTestId('leads-selection-bar')).toBeNull()
  })

  it("select A → פעולות → select B closes A's sheet and keeps B selected", () => {
    renderList()
    enterSelection(screen.getAllByTestId('lead-row')[0])
    fireEvent.click(screen.getByRole('button', { name: 'פעולות' }))
    expect(screen.getByRole('dialog', { name: 'פעולות לליד' })).toBeTruthy()
    tap(screen.getAllByTestId('lead-row')[1])
    expect(screen.queryByRole('dialog', { name: 'פעולות לליד' })).toBeNull()
    expect(screen.getByTestId('leads-selection-bar').textContent).toContain('נבחרו 2')
  })

  it('delete is confirm-gated, optimistic, and rolls back on failure', async () => {
    H.deleteManyLeads.mockResolvedValueOnce({
      deletedCount: 0,
      blockedCount: 0,
      blockedLeads: [],
      reason: null,
    })
    renderList([row()])
    enterSelection(screen.getByTestId('lead-row'))
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    expect(H.deleteManyLeads).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'מחיקת ליד' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'מחק ליד' }))
    await waitFor(() => expect(H.deleteManyLeads).toHaveBeenCalledWith([1]))
    await waitFor(() => expect(screen.getByText('דני לוי')).toBeTruthy())
  })

  it('successful delete removes the row without router.refresh', async () => {
    renderList()
    enterSelection(screen.getAllByTestId('lead-row')[0])
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    fireEvent.click(screen.getByRole('button', { name: 'מחק ליד' }))
    await waitFor(() => expect(H.deleteManyLeads).toHaveBeenCalledWith([1]))
    await waitFor(() => expect(screen.queryByText('דני לוי')).toBeNull())
    expect(screen.getByText('נועה כהן')).toBeTruthy()
    expect(H.refresh).not.toHaveBeenCalled()
  })

  it('selection state is still ids after a rerender', () => {
    const { rerender } = renderList([row()])
    enterSelection(screen.getByTestId('lead-row'))
    rerender(
      <LeadListMobile
        rows={[row()]}
        filters={{ q: '', status: [] }}
        hasMore={false}
        page={1}
        workspaceEmpty={false}
        nowMs={Date.parse('2026-08-13T12:00:00+03:00')}
      />,
    )
    expect(screen.getByTestId('leads-selection-bar').textContent).toContain('נבחרו 1')
  })
})
