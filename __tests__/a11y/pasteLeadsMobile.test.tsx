// @vitest-environment jsdom
//
// Paste-a-column import, on a phone. 62.5% of this product's signups arrive on
// a phone and a measurable share land inside Facebook's in-app browser, where
// there is no spreadsheet on the device to pick — so this is not a convenience,
// it is the only import that can complete there.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  addLeads: vi.fn(),
  uploadLeadData: vi.fn(),
  importLeadsFromCsv: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: H.push, back: () => {}, refresh: H.refresh }),
  usePathname: () => '/leads',
}))
vi.mock('@/actions/clients', () => ({
  addLeads: H.addLeads,
  uploadLeadData: H.uploadLeadData,
  importLeadsFromCsv: H.importLeadsFromCsv,
}))
vi.mock('@/lib/toast', () => ({ toast: H.toast, proToast: vi.fn() }))

import PasteLeadsPanel from '@/components/clients/PasteLeadsPanel'
import LeadImportMobile from '@/modules/leads/mobile/LeadImportMobile'

/** iPhone-class width — the viewport the mobile suite standardises on. */
beforeEach(() => {
  window.innerWidth = 390
  window.innerHeight = 844
  H.addLeads.mockResolvedValue({ success: true, inserted: 2, firstId: 77 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function type(text: string) {
  fireEvent.change(screen.getByLabelText(/הדביקו מספרי טלפון/), { target: { value: text } })
}

describe('PasteLeadsPanel at 390px', () => {
  it('labels the textarea, so the control has an accessible name', () => {
    render(<PasteLeadsPanel />)
    expect(screen.getByLabelText(/הדביקו מספרי טלפון/)).toBeInTheDocument()
  })

  it('is disabled until the paste actually contains a number', () => {
    render(<PasteLeadsPanel />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()

    type('0521234567\n0537654321')
    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('states the real count before the user commits — never a promise', () => {
    render(<PasteLeadsPanel />)
    type('0521234567\n0537654321\n052-123-4567')
    // Third line duplicates the first number, so the honest count is 2.
    expect(screen.getByRole('button')).toHaveTextContent('הוסף 2 לידים')
  })

  it('reports unreadable lines instead of dropping them silently', () => {
    render(<PasteLeadsPanel />)
    type('0521234567\nלא מספר\nגם לא')
    expect(screen.getByRole('status')).toHaveTextContent(/2 שורות לא נקראו/)
  })

  it('imports through the real addLeads with format "paste"', async () => {
    const onImported = vi.fn()
    render(<PasteLeadsPanel onImported={onImported} />)
    type('דנה, 0521234567\n0537654321')
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(H.addLeads).toHaveBeenCalledTimes(1))
    const [rows, format] = H.addLeads.mock.calls[0]
    expect(format).toBe('paste')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ firstName: 'דנה', phone: '0521234567' })
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2, 77))
  })

  it('surfaces a quota refusal rather than failing silently', async () => {
    H.addLeads.mockResolvedValue({ error: 'quota_exceeded', current: 40, limit: 40, attempted: 1, wouldInsert: 1 })
    render(<PasteLeadsPanel />)
    type('0521234567')
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('error', expect.stringContaining('40')))
  })
})

describe('LeadImportMobile — paste is a peer of file, not a hidden fallback', () => {
  it('offers both tabs with accessible names', () => {
    render(<LeadImportMobile open onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: 'קובץ' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'הדבקת מספרים' })).toBeInTheDocument()
  })

  it('switches to the paste panel and marks the selected tab', () => {
    render(<LeadImportMobile open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'הדבקת מספרים' }))

    expect(screen.getByRole('tab', { name: 'הדבקת מספרים' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/הדביקו מספרי טלפון/)).toBeInTheDocument()
    // The file picker is gone, not merely hidden behind it.
    expect(screen.queryByLabelText('בחירת קובץ לידים')).not.toBeInTheDocument()
  })

  it('hands the imported count and lead id to the caller', async () => {
    const onImported = vi.fn()
    render(<LeadImportMobile open onClose={() => {}} onImported={onImported} />)
    fireEvent.click(screen.getByRole('tab', { name: 'הדבקת מספרים' }))
    type('0521234567\n0537654321')
    fireEvent.click(screen.getByRole('button', { name: /הוסף 2 לידים/ }))

    // Third arg is the count of rows the source could not read. Paste reports
    // its unreadable lines inline BEFORE submit, so nothing is skipped here.
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2, 77, 0))
  })
})
