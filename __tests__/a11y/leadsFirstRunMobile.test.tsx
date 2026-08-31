// @vitest-environment jsdom
//
// P0-A — mobile first-run (empty Leads + empty Today) and desktop regression.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/leads',
}))
vi.mock('@/lib/hooksNEvents', () => ({
  useUser: () => ({ id: 7, email: 't@t.com', name: 'T', picture: '', role: 'ADMIN' }),
}))
vi.mock('@/actions/clients', () => ({
  upsertLead: vi.fn(async () => ({})),
  getLeadByIdNum: vi.fn(async () => null),
  uploadLeadData: vi.fn(async () => ({ data: [], wrongData: [] })),
  addLeads: vi.fn(async () => ({ success: true, inserted: 0 })),
  importLeadsFromCsv: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0, invalid: 0 })),
}))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: vi.fn(async () => []) }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: vi.fn(async () => {}) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import LeadListMobile from '@/modules/leads/mobile/LeadListMobile'
import MobileTodayEmpty from '@/modules/today/mobile/MobileTodayEmpty'
import LeadsFirstRunMobile from '@/modules/leads/mobile/LeadsFirstRunMobile'
import { FIRST_RUN_COPY } from '@/lib/activation/firstRunCopy'

afterEach(() => {
  cleanup()
})

function emptyList() {
  return (
    <LeadListMobile rows={[]} filters={{ q: '', status: [] }} hasMore={false} page={1} workspaceEmpty nowMs={0} />
  )
}

describe('P0-A empty Leads first-run', () => {
  it('renders the new first-run, not a desktop handoff', () => {
    render(emptyList())
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.headline })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.add.title) })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.import.title) })).toBeTruthy()
    expect(screen.getByRole('link', { name: /וואטסאפ/ })).toHaveAttribute('href', '/settings/integrations?section=whatsapp')
    expect(screen.getByRole('link', { name: /פייסבוק ואינסטגרם/ })).toHaveAttribute(
      'href',
      '/settings/integrations?section=facebook',
    )
    expect(screen.queryByText(/מחשב/)).toBeNull()
    expect(document.querySelector('table')).toBeNull()
    expect(screen.queryByTestId('leads-add-action')).toBeNull()
  })

  /**
   * ACTIVATION CONTRACT. The screen's job is to say what SocialCRM does before
   * asking for work — the defect that made four consecutive mobile signups leave
   * within seconds without touching a control. These assertions fail if the
   * outcome copy is ever quietly replaced by a greeting again.
   */
  it('states the outcome before asking for any work', () => {
    const { container } = render(emptyList())
    // What the product does, named before any control.
    expect(screen.getByText(FIRST_RUN_COPY.subhead)).toBeTruthy()
    // Both paths are present, each with its own reason to exist.
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.connect.heading })).toBeTruthy()
    expect(screen.getByText(FIRST_RUN_COPY.connect.rationale)).toBeTruthy()
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.own.heading })).toBeTruthy()
    expect(screen.getByText(FIRST_RUN_COPY.own.rationale)).toBeTruthy()
    // Channels are described by outcome, never by connection status. A brand-new
    // workspace must never be greeted by a column of "לא מחובר" labels.
    expect(container.textContent).not.toMatch(/לא מחובר/)
    expect(screen.getByText(FIRST_RUN_COPY.connect.whatsapp.description)).toBeTruthy()
    // Meta ingestion is Lead Ads only — the word that keeps the claim honest.
    expect(FIRST_RUN_COPY.connect.meta.description).toMatch(/מהמודעות/)
    // Terminology: leads are never "customers" (ux-guidelines.md §6).
    expect(container.textContent).not.toMatch(/לקוח/)
  })

  it('add-lead CTA opens the vertical mobile form', () => {
    render(emptyList())
    fireEvent.click(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.add.title) }))
    const form = screen.getByRole('form', { name: 'הוסף ליד' })
    expect(form.className).toMatch(/flex-col/)
    expect(form.querySelector('.flex.w-full.gap-3')).toBeNull()
    expect(screen.getByLabelText('שם פרטי')).toBeTruthy()
    expect(screen.getByLabelText('שם משפחה')).toBeTruthy()
    expect(screen.getByLabelText('טלפון נייד')).toBeTruthy()
    expect(screen.getByLabelText('מייל')).toBeTruthy()
  })

  it('import CTA opens a file picker that accepts xlsx, xls, and csv', () => {
    render(emptyList())
    fireEvent.click(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.import.title) }))
    const input = screen.getByLabelText('בחירת קובץ לידים') as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.accept).toContain('.xlsx')
    expect(input.accept).toContain('.xls')
    expect(input.accept).toContain('.csv')
  })
})

describe('P0-A Today empty matches Leads first-run', () => {
  it('does not contradict Leads and does not send the user to a computer', () => {
    const { container: today } = render(<MobileTodayEmpty />)
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.headline })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.add.title) })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.import.title) })).toBeTruthy()
    expect(today.textContent).not.toMatch(/מחשב/)

    cleanup()
    const { container: leads } = render(<LeadsFirstRunMobile />)
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.headline })).toBeTruthy()
    expect(leads.querySelector('table')).toBeNull()
  })

  /**
   * A workspace with Meta already connected is a DIFFERENT situation from first
   * run — the user has acted and is waiting. It keeps its own reassurance copy,
   * and must not be shown a connect offer it has already taken.
   */
  it('connected workspace gets reassurance, not the connect pitch again', () => {
    const { container } = render(<LeadsFirstRunMobile metaConnected whatsappConnected />)
    expect(screen.getByRole('heading', { name: FIRST_RUN_COPY.connected.headline })).toBeTruthy()
    expect(container.textContent).toContain(FIRST_RUN_COPY.connected.subhead)
    expect(screen.queryByRole('link', { name: /פייסבוק ואינסטגרם/ })).toBeNull()
    // The alternative path stays available — a connected workspace can still
    // want to import the list it already has.
    expect(screen.getByRole('button', { name: new RegExp(FIRST_RUN_COPY.own.import.title) })).toBeTruthy()
  })
})

describe('P0-A desktop first-run is unchanged', () => {
  it('LeadsFirstRun still owns ClientFormPop and UploadClientData', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/clients/LeadsFirstRun.tsx'), 'utf8')
    expect(src).toContain("import ClientFormPop")
    expect(src).toContain("import UploadClientData")
    expect(src).toContain("import OnboardingActionCard")
    expect(src).not.toContain('LeadFormMobile')
    expect(src).not.toContain('LeadImportMobile')
    expect(src).not.toContain('LeadsFirstRunMobile')
  })

  it('ClientForm still uses the desktop horizontal rows', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/clients/clientForm.tsx'), 'utf8')
    expect(src).toContain("className='flex w-full gap-3'")
    expect(src).not.toContain('LeadFormMobile')
  })

  it('UploadClientData still uses the desktop result grid', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/settings/UploadClientData.tsx'), 'utf8')
    expect(src).toContain('grid-cols-2')
    expect(src).toContain('FileUploader')
    expect(src).not.toContain('LeadImportMobile')
  })
})
