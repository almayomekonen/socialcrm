// @vitest-environment jsdom
//
// Accessibility + structure for the Phase A mobile lead detail actions.
//
// Guarantees:
//   1. Status / follow-up / outcome are named buttons that open named dialogs.
//   2. Call is a real `tel:` anchor; WhatsApp opens the SocialCRM conversation.
//   3. Without a phone, the contact bar is absent — never a dead sticky strip.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => '/clients/1/summary',
}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async () => {}),
}))
vi.mock('@/actions/clients', () => ({
  updateLead: vi.fn(async () => ({})),
  upsertLead: vi.fn(async () => ({})),
  getLeadByIdNum: vi.fn(async () => null),
  uploadLeadData: vi.fn(async () => ({ data: [], wrongData: [] })),
  addLeads: vi.fn(async () => ({ success: true, inserted: 0 })),
  importLeadsFromCsv: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0, invalid: 0 })),
  deleteLead: vi.fn(async () => ({ success: true })),
  deleteManyLeads: vi.fn(async () => ({ deletedCount: 1, blockedCount: 0, blockedLeads: [], reason: null })),
}))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({
  openLeadWhatsappInInbox: vi.fn(async () => {}),
}))
vi.mock('@/actions/leadFollowUp', () => ({
  setLeadFollowUp: vi.fn(async () => ({})),
  clearLeadFollowUp: vi.fn(async () => ({})),
}))
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: vi.fn(async () => ({})) }))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: vi.fn(async () => []) }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: vi.fn(async () => {}) }))

import LeadDetailActions from '@/modules/leads/mobile/LeadDetailActions'
import LeadListMobile from '@/modules/leads/mobile/LeadListMobile'
import type { MobileLeadRow } from '@/modules/leads/queries'
import { FIRST_RUN_COPY } from '@/lib/activation/firstRunCopy'

afterEach(() => {
  cleanup()
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

describe('lead detail actions', () => {
  test('1. status, follow-up and outcome are named buttons that open named dialogs', () => {
    render(
      <LeadDetailActions leadId={1} phone='0541234567' name='דני לוי' status='new' nextFollowUpAt={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'סטטוס' }))
    expect(screen.getByRole('dialog', { name: 'סטטוס' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }))

    fireEvent.click(screen.getByRole('button', { name: 'מעקב' }))
    expect(screen.getByRole('dialog', { name: 'מעקב' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }))

    fireEvent.click(screen.getByRole('button', { name: 'תוצאה' }))
    expect(screen.getByRole('dialog', { name: 'תוצאת שיחה' })).toBeTruthy()
  })

  test('overflow actions open a sheet with existing mutations only', () => {
    render(
      <LeadDetailActions leadId={1} phone='0541234567' name='דני לוי' status='new' nextFollowUpAt={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'פעולות' }))
    expect(screen.getByRole('dialog', { name: 'פעולות' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'שינוי סטטוס' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'הוספת מעקב' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'פתיחת שיחה' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'מחיקת ליד' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'עריכת ליד' })).toBeNull()
  })

  test('lead delete is confirm-gated and does not fire on opening פעולות', async () => {
    const { deleteLead } = await import('@/actions/clients')
    render(
      <LeadDetailActions leadId={1} phone='0541234567' name='דני לוי' status='new' nextFollowUpAt={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'פעולות' }))
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת ליד' }))
    expect(deleteLead).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'מחיקת ליד' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'מחק ליד' }))
    await waitFor(() => expect(deleteLead).toHaveBeenCalledWith(1))
  })

  test('2. Call is a real tel: anchor', () => {
    render(
      <LeadDetailActions leadId={1} phone='0541234567' name='דני לוי' status='new' nextFollowUpAt={null} />,
    )
    const call = screen.getByRole('link', { name: 'התקשר לדני לוי' })
    expect(call.getAttribute('href')).toBe('tel:0541234567')
  })

  /**
   * WhatsApp KEEPS THE REP INSIDE SOCIALCRM.
   *
   * It used to be a `wa.me` anchor, which ejected the rep into another app: the
   * reply was never recorded and the CRM lost the thread. It now resolves the
   * real conversation and navigates to `/inbox?conversation=<id>`, so it is a
   * BUTTON, not a link — asserted here so a future refactor cannot quietly
   * restore the external hop.
   */
  test('2b. WhatsApp is an in-app action, not an external wa.me link', () => {
    render(
      <LeadDetailActions leadId={1} phone='0541234567' name='דני לוי' status='new' nextFollowUpAt={null} />,
    )
    expect(screen.queryByRole('link', { name: 'וואטסאפ לדני לוי' })).toBeNull()
    const wa = screen.getByRole('button', { name: 'וואטסאפ לדני לוי' })
    expect(wa.getAttribute('href')).toBeNull()
  })

  test('3. without a phone the contact bar is absent', () => {
    render(<LeadDetailActions leadId={1} phone={null} name='דני לוי' status='new' nextFollowUpAt={null} />)
    expect(screen.queryByRole('link', { name: /התקשר/ })).toBeNull()
    // WhatsApp is a button now; with no number there is nothing to resolve and
    // no fallback, so it must be absent rather than present-and-refusing.
    expect(screen.queryByRole('button', { name: /וואטסאפ/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'סטטוס' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'פעולות' })).toBeTruthy()
  })
})

describe('lead list', () => {
  test('cards link to lead summary and name the contact actions', () => {
    render(
      <LeadListMobile
        rows={[row()]}
        filters={{ q: '', status: [] }}
        hasMore={false}
        page={1}
        workspaceEmpty={false}
        nowMs={Date.parse('2026-08-13T12:00:00+03:00')}
      />,
    )
    const card = screen.getAllByRole('link').find((el) => el.getAttribute('href') === '/clients/1/summary')
    expect(card).toBeTruthy()
    expect(card!.textContent).toContain('דני לוי')
    expect(screen.getByRole('link', { name: 'התקשר לדני לוי' }).getAttribute('href')).toBe('tel:0541234567')
    expect(screen.getByRole('search')).toBeTruthy()
  })

  test('workspace-empty is not the same as filtered-empty', () => {
    const { rerender } = render(
      <LeadListMobile rows={[]} filters={{ q: '', status: [] }} hasMore={false} page={1} workspaceEmpty nowMs={0} />,
    )
    // First-run copy is owned by lib/activation/firstRunCopy.ts and asserted
    // through it, so a copy change updates every surface at once instead of
    // failing four suites. Names are matched loosely: each control's accessible
    // name is its title plus the outcome line beneath it.
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.headline })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.add.title) })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.import.title) })).toBeTruthy()
    expect(screen.queryByText(/מחשב/)).toBeNull()

    rerender(
      <LeadListMobile
        rows={[]}
        filters={{ q: 'xyz', status: [] }}
        hasMore={false}
        page={1}
        workspaceEmpty={false}
        nowMs={0}
      />,
    )
    expect(screen.getByRole('heading', { name: 'לא נמצאו לידים' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'נקה סינון' }).getAttribute('href')).toBe('/leads')
  })
})
