// @vitest-environment jsdom
//
// Populated mobile Leads — add / import from the header +, without changing
// the empty first-run or the desktop table.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  upsertLead: vi.fn(),
  getLeadByIdNum: vi.fn(async () => null),
  findDuplicateLeads: vi.fn(async () => []),
  recordFirstLeadEvent: vi.fn(async () => {}),
  uploadLeadData: vi.fn(),
  addLeads: vi.fn(),
  importLeadsFromCsv: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: H.push, back: () => {}, refresh: H.refresh }),
  usePathname: () => '/leads',
}))
vi.mock('@/lib/hooksNEvents', () => ({
  useUser: () => ({ id: 7, email: 't@t.com', name: 'T', picture: '', role: 'ADMIN' }),
}))
vi.mock('@/actions/clients', () => ({
  upsertLead: H.upsertLead,
  getLeadByIdNum: H.getLeadByIdNum,
  uploadLeadData: H.uploadLeadData,
  addLeads: H.addLeads,
  importLeadsFromCsv: H.importLeadsFromCsv,
  deleteManyLeads: vi.fn(async () => ({ deletedCount: 0, blockedCount: 0, blockedLeads: [], reason: null })),
  updateLead: vi.fn(async () => ({})),
}))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: H.findDuplicateLeads }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: H.recordFirstLeadEvent }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn(async () => {}) }))
vi.mock('@/actions/leadFollowUp', () => ({
  setLeadFollowUp: vi.fn(async () => ({})),
  clearLeadFollowUp: vi.fn(async () => ({})),
}))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({
  openLeadWhatsappInInbox: vi.fn(async () => {}),
}))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))
vi.mock('@/actions/auth', () => ({ logout: vi.fn() }))

import LeadListMobile from '@/modules/leads/mobile/LeadListMobile'
import MobileWorkspaceShell from '@/components/mobile/MobileWorkspaceShell'
import MobileMoreView from '@/components/mobile/MobileMoreView'
import { visibleMoreItems } from '@/components/mobile/moreDestinations'
import type { MobileLeadRow } from '@/modules/leads/queries'
import { FIRST_RUN_COPY } from '@/lib/activation/firstRunCopy'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

function populated(rows: MobileLeadRow[] = [row()]) {
  return (
    <MobileWorkspaceShell>
      <LeadListMobile
        rows={rows}
        filters={{ q: '', status: [] }}
        hasMore={false}
        page={1}
        workspaceEmpty={false}
        nowMs={Date.parse('2026-08-13T12:00:00+03:00')}
      />
    </MobileWorkspaceShell>
  )
}

function empty() {
  return (
    <MobileWorkspaceShell>
      <LeadListMobile rows={[]} filters={{ q: '', status: [] }} hasMore={false} page={1} workspaceEmpty nowMs={0} />
    </MobileWorkspaceShell>
  )
}

function openAdd() {
  fireEvent.click(screen.getByTestId('leads-add-action'))
  fireEvent.click(screen.getByRole('button', { name: 'הוסף ליד' }))
}

function fillNames() {
  fireEvent.change(screen.getByLabelText('שם פרטי'), { target: { value: 'דני' } })
  fireEvent.change(screen.getByLabelText('שם משפחה'), { target: { value: 'לוי' } })
}

describe('populated mobile Leads add/import', () => {
  it('exposes a header + and keeps search/filter on their own row', () => {
    render(populated())
    const add = screen.getByTestId('leads-add-action')
    expect(add.getAttribute('aria-label')).toBe('הוספת ליד')
    expect(add.className).toMatch(/size-11/)
    expect(add.className).toMatch(/rounded-md/)
    expect(add.className).not.toMatch(/rounded-full/)
    expect(document.querySelector('[data-mobile-header]')?.contains(add)).toBe(true)
    const rowEl = screen.getByTestId('lead-search-filter-row')
    expect(rowEl.contains(add)).toBe(false)
    expect(rowEl.contains(screen.getByRole('search'))).toBe(true)
    expect(rowEl.contains(screen.getByRole('button', { name: 'סינון לפי סטטוס' }))).toBe(true)
  })

  it('+ opens the add/import action sheet', () => {
    render(populated())
    fireEvent.click(screen.getByTestId('leads-add-action'))
    expect(screen.getByRole('dialog', { name: 'הוספת ליד' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'הוסף ליד' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ייבוא לידים' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeTruthy()
  })

  it('הוסף ליד opens LeadFormMobile and does not keep the chooser open', () => {
    render(populated())
    openAdd()
    expect(screen.queryByRole('dialog', { name: 'הוספת ליד' })).toBeNull()
    const form = screen.getByRole('form', { name: 'הוסף ליד' })
    expect(form.className).toMatch(/flex-col/)
    expect(screen.getByLabelText('שם פרטי')).toBeTruthy()
    expect(screen.getByLabelText('טלפון נייד')).toBeTruthy()
  })

  it('ייבוא לידים opens LeadImportMobile', () => {
    render(populated())
    fireEvent.click(screen.getByTestId('leads-add-action'))
    fireEvent.click(screen.getByRole('button', { name: 'ייבוא לידים' }))
    expect(screen.queryByRole('dialog', { name: 'הוספת ליד' })).toBeNull()
    const input = screen.getByLabelText('בחירת קובץ לידים') as HTMLInputElement
    expect(input.accept).toContain('.xlsx')
    expect(input.accept).toContain('.xls')
    expect(input.accept).toContain('.csv')
  })

  it('successful add uses upsertLead and navigates without first-lead analytics', async () => {
    H.upsertLead.mockResolvedValue({ id: 88 })
    render(populated())
    openAdd()
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(H.upsertLead).toHaveBeenCalled())
    expect(H.upsertLead.mock.calls[0][0]).toBe(7)
    expect(H.upsertLead.mock.calls[0][1]).toEqual(expect.objectContaining({ firstName: 'דני', lastName: 'לוי' }))
    await waitFor(() => expect(H.push).toHaveBeenCalledWith('/clients/88/summary'))
    expect(H.recordFirstLeadEvent).not.toHaveBeenCalled()
    expect(H.refresh).not.toHaveBeenCalled()
  })

  it('import preview still uses uploadLeadData and a stacked summary', async () => {
    H.uploadLeadData.mockResolvedValue({
      data: [{ firstName: 'א', lastName: 'כהן', idNum: '1' }],
      wrongData: [{ firstName: 'ג', lastName: 'פסול', idNum: 'x' }],
    })
    render(populated())
    fireEvent.click(screen.getByTestId('leads-add-action'))
    fireEvent.click(screen.getByRole('button', { name: 'ייבוא לידים' }))
    fireEvent.change(screen.getByLabelText('בחירת קובץ לידים'), {
      target: {
        files: [new File(['x'], 'leads.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })],
      },
    })
    await waitFor(() => expect(screen.getByText('מצאנו 2 לידים')).toBeTruthy())
    expect(screen.getByText('1 תקינים')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })

  it('duplicate warning remains advisory', async () => {
    H.findDuplicateLeads.mockResolvedValue([
      {
        id: 3,
        name: 'דני קיים',
        status: 'new',
        phone: '0500000000',
        email: null,
        confidence: 'certain',
        signals: ['phone'],
      },
    ])
    H.upsertLead.mockResolvedValue({ id: 42 })
    render(populated())
    openAdd()
    fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: '0500000000' } })
    fireEvent.blur(screen.getByLabelText('טלפון נייד'))
    await waitFor(() => expect(screen.getByText(/כבר קיים במערכת|ליד דומה/)).toBeTruthy(), { timeout: 2000 })
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(H.upsertLead).toHaveBeenCalled())
  })

  it('quota errors still open the mobile paywall', async () => {
    H.upsertLead.mockResolvedValue({
      error: 'quota_exceeded',
      current: 50,
      limit: 50,
      attempted: 1,
    })
    render(populated())
    openAdd()
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'שדרג עכשיו' })).toBeTruthy())
    expect(screen.getByRole('dialog', { name: 'מכסת הלידים' })).toBeTruthy()
    expect(document.querySelector('[class*="min-w-[340px]"]')).toBeNull()
  })

  it('+ never enters selection; selection hides + and closes the chooser', () => {
    render(populated())
    fireEvent.click(screen.getByTestId('leads-add-action'))
    expect(screen.getByRole('dialog', { name: 'הוספת ליד' })).toBeTruthy()
    fireEvent.contextMenu(screen.getByTestId('leads-add-action'))
    expect(screen.queryByTestId('leads-selection-bar')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('lead-row'))
    expect(screen.getByTestId('leads-selection-bar')).toBeTruthy()
    expect(screen.queryByTestId('leads-add-action')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'הוספת ליד' })).toBeNull()
  })
})

describe('empty workspace is unchanged', () => {
  it('still offers add/import on the page and does not show the populated +', () => {
    render(empty())
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.headline })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.add.title) })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.import.title) })).toBeTruthy()
    expect(screen.queryByTestId('leads-add-action')).toBeNull()
    expect(screen.queryByText(/מחשב/)).toBeNull()
  })
})

describe('desktop surfaces stay on their own components', () => {
  it('ClientsTable / first-run / forms do not mount the mobile add path', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
    const table = read('components/clients/clientsTable.tsx')
    expect(table).not.toContain('LeadFormMobile')
    expect(table).not.toContain('LeadImportMobile')
    expect(table).not.toContain('LeadListAddControl')
    const firstRun = read('components/clients/LeadsFirstRun.tsx')
    expect(firstRun).not.toContain('LeadListAddControl')
    expect(firstRun).not.toContain('LeadsAddSheet')
  })
})

describe('mobile More copy', () => {
  it('does not claim Excel import is desktop-only', () => {
    render(
      <MobileMoreView
        name='אלמוג'
        email='a@example.com'
        items={visibleMoreItems({ role: 'ADMIN', inspectorEnabled: true })}
      />,
    )
    expect(screen.queryByText(/ייבוא מאקסל/)).toBeNull()
    expect(screen.getByText('חשבוניות, דוחות ואוטומציות זמינים בגרסת המחשב.')).toBeTruthy()
  })
})
