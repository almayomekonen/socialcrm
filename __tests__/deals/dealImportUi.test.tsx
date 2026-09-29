// @vitest-environment jsdom
//
// Deals page integration: the "ייבוא עסקאות" action in the SalesTable toolbar
// opens the deal import (not the lead import), and the flow is
// choose file → parse → confirm → import → result.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  uploadDealData: vi.fn(),
  importDeals: vi.fn(),
  revalidateDealImport: vi.fn(async () => {}),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: H.refresh }),
  usePathname: () => '/deals',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}))
vi.mock('@/actions/dealImport', () => ({ uploadDealData: H.uploadDealData, importDeals: H.importDeals, revalidateDealImport: H.revalidateDealImport }))
vi.mock('@/actions/salesTbl', () => ({
  deleteDeal: vi.fn(),
  deleteManyDeals: vi.fn(),
  getDealDataToExport: vi.fn(),
  updateDealStatus: vi.fn(),
}))
vi.mock('@/actions/global', () => ({ saveTblPref: vi.fn() }))
vi.mock('@/actions/clients', () => ({ searchContacts: vi.fn() }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => false }))

import SalesTable from '@/components/sales/salesTable/SalesTable'
import UploadDealsData from '@/components/sales/UploadDealsData'
import { PosProvider, Provider, UserProvider } from '@/lib/hooksNEvents'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ROW = { row: 2, amount: 100, status: 'חדש', saleDt: null, prdct: null, notes: null, phone: '0521234567', email: null, firstName: 'דנה', lastName: null }

function pick() {
  fireEvent.change(screen.getByLabelText('בחירת קובץ עסקאות'), {
    target: { files: [new File(['x'], 'transaction.xlsx')] },
  })
}

describe('Deals page — ייבוא עסקאות', () => {
  it('the toolbar action opens the deal import modal', async () => {
    const setFn = vi.fn()
    const user = { id: 1, role: 'AGNT' }
    // The same providers the app shell and app/(app)/deals/page.tsx supply.
    render(
      <UserProvider user={user}>
        <PosProvider>
          <Provider props={{ tableLength: 0, count: 0, sqlExport: '', params: {}, gotPermIds: [1] }}>
            <SalesTable
              props={{ data: [], params: {}, rawFilter: {}, user, formProps: {}, setCurSale: setFn, setOpenForm: setFn, curSale: null }}
            />
          </Provider>
        </PosProvider>
      </UserProvider>,
    )
    expect(screen.queryByLabelText('בחירת קובץ עסקאות')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'ייבוא עסקאות' }))

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('בחירת קובץ עסקאות') as HTMLInputElement
    expect(input.accept).toBe('.xlsx,.xls')
    // The deal importer, not the lead importer that used to sit in this modal.
    expect(within(dialog).queryByText(/לידים שנשמרו/)).toBeNull()
  })
})

describe('UploadDealsData flow', () => {
  it('parses, asks for confirmation, imports, and reports imported / duplicates / rejected', async () => {
    H.uploadDealData.mockResolvedValue({ data: [ROW], wrongData: [{ row: 3, reason: 'סכום חסר או לא תקין', label: 'יוסי' }] })
    H.importDeals.mockResolvedValue({ imported: 1, duplicates: 2, createdLeads: 1, rejected: [{ row: 4, reason: 'לא נמצא ליד תואם', label: '' }] })
    render(<UploadDealsData />)
    pick()

    await waitFor(() => expect(screen.getByText(/נמצאו 1 עסקאות תקינות ו-1 שורות לא תקינות/)).toBeInTheDocument())
    expect(H.importDeals).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'ייבוא עסקאות' }))
    await waitFor(() => expect(screen.getByText('יובאו בהצלחה 1 עסקאות')).toBeInTheDocument())
    expect(H.importDeals).toHaveBeenCalledWith([ROW])
    expect(screen.getByText('דולגו 2 עסקאות שכבר קיימות')).toBeInTheDocument()
    expect(screen.getByText('נוצרו 1 לידים חדשים')).toBeInTheDocument()
    expect(screen.getByText('שורה 3: סכום חסר או לא תקין (יוסי)')).toBeInTheDocument()
    expect(screen.getByText('שורה 4: לא נמצא ליד תואם')).toBeInTheDocument()
    // The deals data revalidates only once the importer closes, so the result stays readable.
    expect(H.revalidateDealImport).not.toHaveBeenCalled()
    cleanup()
    expect(H.revalidateDealImport).toHaveBeenCalledTimes(1)
  })

  it('shows the quota paywall when creating missing leads would exceed the quota', async () => {
    H.uploadDealData.mockResolvedValue({ data: [ROW], wrongData: [] })
    H.importDeals.mockResolvedValue({ error: 'quota_exceeded', current: 50, limit: 50, attempted: 1 })
    render(<UploadDealsData />)
    pick()
    fireEvent.click(await screen.findByRole('button', { name: 'ייבוא עסקאות' }))
    await waitFor(() => expect(H.importDeals).toHaveBeenCalled())
    expect(await screen.findByRole('dialog', { name: 'מכסת הלידים' })).toBeInTheDocument()
    expect(screen.queryByText(/יובאו בהצלחה/)).toBeNull()
  })

  it('surfaces a file-level error without importing', async () => {
    H.uploadDealData.mockResolvedValue({ data: [], wrongData: [], error: 'לא זיהינו עמודות מתאימות בקובץ.' })
    render(<UploadDealsData />)
    pick()
    expect(await screen.findByText('לא זיהינו עמודות מתאימות בקובץ.')).toBeInTheDocument()
    expect(H.importDeals).not.toHaveBeenCalled()
  })
})
