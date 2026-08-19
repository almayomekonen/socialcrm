// @vitest-environment jsdom
//
// P0-A — mobile import: native picker, existing parsers, stacked summary (no table).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  uploadLeadData: vi.fn(),
  addLeads: vi.fn(),
  importLeadsFromCsv: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: H.refresh }),
  usePathname: () => '/leads',
}))
vi.mock('@/actions/clients', () => ({
  uploadLeadData: H.uploadLeadData,
  addLeads: H.addLeads,
  importLeadsFromCsv: H.importLeadsFromCsv,
}))

import LeadImportMobile from '@/modules/leads/mobile/LeadImportMobile'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function pick(file: File) {
  fireEvent.change(screen.getByLabelText('בחירת קובץ לידים'), { target: { files: [file] } })
}

describe('LeadImportMobile', () => {
  it('accepts xlsx, xls, and csv', () => {
    render(<LeadImportMobile open onClose={() => {}} />)
    const input = screen.getByLabelText('בחירת קובץ לידים') as HTMLInputElement
    expect(input.accept).toMatch(/\.xlsx/)
    expect(input.accept).toMatch(/\.xls/)
    expect(input.accept).toMatch(/\.csv/)
  })

  it('shows a stacked excel summary, not a desktop table, then imports via addLeads', async () => {
    H.uploadLeadData.mockResolvedValue({
      data: [
        { firstName: 'א', lastName: 'כהן', idNum: '1' },
        { firstName: 'ב', lastName: 'לוי', idNum: '2' },
      ],
      wrongData: [{ firstName: 'ג', lastName: 'פסול', idNum: 'x' }],
    })
    H.addLeads.mockResolvedValue({ success: true, inserted: 2 })
    render(<LeadImportMobile open onClose={() => {}} />)
    pick(new File(['x'], 'leads.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))

    await waitFor(() => expect(screen.getByText('מצאנו 3 לידים')).toBeTruthy())
    expect(screen.getByText('2 תקינים')).toBeTruthy()
    expect(screen.getByText('1 דורשים בדיקה')).toBeTruthy()
    expect(screen.getByText('ג פסול')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
    expect(H.addLeads).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'ייבא 2 לידים' }))
    await waitFor(() => expect(H.addLeads).toHaveBeenCalled())
    expect(H.addLeads.mock.calls[0][0]).toHaveLength(2)
  })

  it('csv uses importLeadsFromCsv and keeps the result stacked', async () => {
    H.importLeadsFromCsv.mockResolvedValue({ inserted: 5, updated: 0, unchanged: 1, invalid: 2 })
    render(<LeadImportMobile open onClose={() => {}} />)
    pick(new File(['name,phone\n'], 'leads.csv', { type: 'text/csv' }))

    await waitFor(() => expect(H.importLeadsFromCsv).toHaveBeenCalled())
    expect(H.addLeads).not.toHaveBeenCalled()
    expect(screen.getByText(/נוספו 5 לידים/)).toBeTruthy()
    expect(screen.getByText('שורות לא תקינות: 2')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })
})
