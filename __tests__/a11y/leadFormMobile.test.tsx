// @vitest-environment jsdom
//
// P0-A — mobile add-lead sheet: existing upsertLead, advisory duplicates, quota, validation.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  push: vi.fn(),
  upsertLead: vi.fn(),
  getLeadByIdNum: vi.fn(async () => null),
  findDuplicateLeads: vi.fn(async () => []),
  recordFirstLeadEvent: vi.fn(async () => {}),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: H.push, back: () => {}, refresh: () => {} }),
  usePathname: () => '/leads',
}))
vi.mock('@/lib/hooksNEvents', () => ({
  useUser: () => ({ id: 7, email: 't@t.com', name: 'T', picture: '', role: 'ADMIN' }),
}))
vi.mock('@/actions/clients', () => ({
  upsertLead: H.upsertLead,
  getLeadByIdNum: H.getLeadByIdNum,
  uploadLeadData: vi.fn(async () => ({ data: [], wrongData: [] })),
  addLeads: vi.fn(async () => ({ success: true, inserted: 0 })),
  importLeadsFromCsv: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0, invalid: 0 })),
}))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: H.findDuplicateLeads }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: H.recordFirstLeadEvent }))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))

import LeadFormMobile from '@/modules/leads/mobile/LeadFormMobile'
import LeadsFirstRunMobile from '@/modules/leads/mobile/LeadsFirstRunMobile'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function fillNames() {
  fireEvent.change(screen.getByLabelText('שם פרטי'), { target: { value: 'דני' } })
  fireEvent.change(screen.getByLabelText('שם משפחה'), { target: { value: 'לוי' } })
}

describe('LeadFormMobile', () => {
  it('uses a vertical layout, not the desktop 3-row flex', () => {
    render(<LeadFormMobile open onClose={() => {}} />)
    const form = screen.getByRole('form', { name: 'הוסף ליד' })
    expect(form.className).toMatch(/flex-col/)
    expect(form.querySelector('.flex.w-full.gap-3')).toBeNull()
  })

  it('calls the existing upsertLead action on submit', async () => {
    H.upsertLead.mockResolvedValue({ id: 42 })
    render(<LeadFormMobile open onClose={() => {}} />)
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(H.upsertLead).toHaveBeenCalled())
    expect(H.upsertLead.mock.calls[0][0]).toBe(7)
    expect(H.upsertLead.mock.calls[0][1]).toEqual(
      expect.objectContaining({ firstName: 'דני', lastName: 'לוי' }),
    )
  })

  it('duplicate warning is advisory — submit still calls upsertLead', async () => {
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
    render(<LeadFormMobile open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: '0500000000' } })
    fireEvent.blur(screen.getByLabelText('טלפון נייד'))
    await waitFor(() => expect(screen.getByText(/כבר קיים במערכת|ליד דומה/)).toBeTruthy(), { timeout: 2000 })
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(H.upsertLead).toHaveBeenCalled())
  })

  it('quota errors open the mobile paywall, not the desktop min-width modal', async () => {
    H.upsertLead.mockImplementation(async () => ({
      error: 'quota_exceeded',
      current: 50,
      limit: 50,
      attempted: 1,
    }))
    render(<LeadFormMobile open onClose={() => {}} />)
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(H.upsertLead).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'שדרג עכשיו' })).toBeTruthy())
    expect(screen.getByRole('dialog', { name: 'מכסת הלידים' })).toBeTruthy()
    expect(document.querySelector('[class*="min-w-[340px]"]')).toBeNull()
  })

  it('renders validation errors inline', async () => {
    H.upsertLead.mockResolvedValue({ err: true, msg: 'שגיאה בשמירת לקוח' })
    render(<LeadFormMobile open onClose={() => {}} />)
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשמירת לקוח'))
  })

  it('successful create navigates to the existing lead detail route', async () => {
    H.upsertLead.mockResolvedValue({ id: 88 })
    render(<LeadsFirstRunMobile />)
    fireEvent.click(screen.getAllByRole('button', { name: 'הוסף ליד' })[0])
    fillNames()
    fireEvent.submit(screen.getByRole('form', { name: 'הוסף ליד' }))
    await waitFor(() => expect(H.push).toHaveBeenCalledWith('/clients/88/summary?firstLead=1'))
    expect(H.recordFirstLeadEvent).toHaveBeenCalledWith('first_manual_lead_created')
  })
})
