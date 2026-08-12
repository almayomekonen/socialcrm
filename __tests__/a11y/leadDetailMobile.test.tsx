// @vitest-environment jsdom
//
// Accessibility + structure for the Phase A mobile lead detail actions.
//
// Guarantees:
//   1. Status / follow-up / outcome are named buttons that open named dialogs.
//   2. Call and WhatsApp are real anchors (tel: / wa.me), not JS click handlers.
//   3. Without a phone, the contact bar is absent — never a dead sticky strip.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/clients/1/summary',
}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async () => {}),
}))
vi.mock('@/actions/clients', () => ({ updateLead: vi.fn(async () => ({})) }))
vi.mock('@/actions/leadFollowUp', () => ({
  setLeadFollowUp: vi.fn(async () => ({})),
  clearLeadFollowUp: vi.fn(async () => ({})),
}))
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: vi.fn(async () => ({})) }))

import LeadDetailActions from '@/modules/leads/mobile/LeadDetailActions'
import LeadListMobile from '@/modules/leads/mobile/LeadListMobile'
import type { MobileLeadRow } from '@/modules/leads/queries'

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

  test('2. Call and WhatsApp are real tel: / wa.me anchors', () => {
    render(
      <LeadDetailActions leadId={1} phone='0541234567' name='דני לוי' status='new' nextFollowUpAt={null} />,
    )
    const call = screen.getByRole('link', { name: 'התקשר לדני לוי' })
    expect(call.getAttribute('href')).toBe('tel:0541234567')
    const wa = screen.getByRole('link', { name: 'וואטסאפ לדני לוי' })
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\//)
    expect(wa.getAttribute('href')?.includes('text=')).toBe(false)
  })

  test('3. without a phone the contact bar is absent', () => {
    render(<LeadDetailActions leadId={1} phone={null} name='דני לוי' status='new' nextFollowUpAt={null} />)
    expect(screen.queryByRole('link', { name: /התקשר/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /וואטסאפ/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'סטטוס' })).toBeTruthy()
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
    expect(screen.getByRole('heading', { name: 'עוד אין לידים במערכת' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'חבר מקור לידים' }).getAttribute('href')).toBe('/settings/integrations')

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
