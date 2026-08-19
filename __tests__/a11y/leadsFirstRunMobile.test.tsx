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
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import LeadListMobile from '@/modules/leads/mobile/LeadListMobile'
import MobileTodayEmpty from '@/modules/today/mobile/MobileTodayEmpty'
import LeadsFirstRunMobile from '@/modules/leads/mobile/LeadsFirstRunMobile'

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
    expect(screen.getByRole('heading', { name: 'בואו נתחיל' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'הוסף ליד' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ייבוא לידים' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /וואטסאפ/ })).toHaveAttribute('href', '/settings/integrations?section=whatsapp')
    expect(screen.getByRole('link', { name: /פייסבוק ואינסטגרם/ })).toHaveAttribute(
      'href',
      '/settings/integrations?section=facebook',
    )
    expect(screen.queryByText(/מחשב/)).toBeNull()
    expect(document.querySelector('table')).toBeNull()
    expect(screen.queryByTestId('leads-add-action')).toBeNull()
  })

  it('add-lead CTA opens the vertical mobile form', () => {
    render(emptyList())
    fireEvent.click(screen.getByRole('button', { name: 'הוסף ליד' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'ייבוא לידים' }))
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
    expect(screen.getByRole('heading', { name: 'בואו נתחיל' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'הוסף ליד' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ייבוא לידים' })).toBeTruthy()
    expect(today.textContent).not.toMatch(/מחשב/)

    cleanup()
    const { container: leads } = render(<LeadsFirstRunMobile />)
    expect(screen.getByRole('heading', { name: 'בואו נתחיל' })).toBeTruthy()
    expect(leads.querySelector('table')).toBeNull()
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
