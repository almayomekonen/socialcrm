// @vitest-environment jsdom

/**
 * ClientsTable — minimal critical render tests
 *
 * Strategy
 * --------
 * • Mock only what would otherwise pull server-only code into a jsdom run:
 *     - Next.js infrastructure (navigation, cache, headers)
 *     - Server actions (`@/actions/clients`, `@/actions/global`)
 *     - Background hooks (`useLeadPolling`, `useKeepTblScrollPos`)
 * • No component mocks — we want real render paths for status changes + tabs.
 * • Assertions focus on user-visible behavior: the controlled `<select>` value
 *   and whether the row is present in the DOM under the current tab.
 */

import { vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => null, set: vi.fn(), delete: vi.fn() }),
  headers: () => ({ get: () => null }),
}))

vi.mock('@/actions/clients', () => ({
  updateLead: vi.fn().mockResolvedValue({ ok: true }),
  deleteLead: vi.fn().mockResolvedValue({ ok: true }),
  deleteManyLeads: vi.fn().mockResolvedValue({ deleted: 0 }),
  searchContacts: vi.fn().mockResolvedValue([]),
  searchLeads: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/actions/global', () => ({
  saveTblPref: vi.fn().mockResolvedValue({ ok: true }),
}))

// Keep every other export intact; silence background hooks and give
// `useProps` a safe default so context-less children don't explode.
vi.mock('@/lib/hooksNEvents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hooksNEvents')>(
    '@/lib/hooksNEvents',
  )
  return {
    ...actual,
    useLeadPolling: vi.fn(),
    useKeepTblScrollPos: vi.fn(),
    useProps: () => ({ clientLists: [], params: {} }),
  }
})

import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ClientsTable from '@/components/clients/clientsTable'

afterEach(() => {
  cleanup()
})

function makeLead(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 1,
    name: 'John Tester',
    phone: '0501234567',
    status: 'new',
    leadSource: 'manual',
    userName: 'agent',
    handlerName: 'mgr',
    email: 'john@example.test',
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Anchored so "ליד חדש" (new-lead toolbar button) doesn't collide with the
// "חדש" tab button; tab accessible names are shaped like "חדש 1".
const STATUS_TAB_LABEL: Record<string, RegExp> = {
  new:        /^חדש\b/,
  contacted:  /^בטיפול\b/,
  interested: /^מעוניין\b/,
  closed:     /^סגור\b/,
  lost:       /^אבוד\b/,
}

function getStatusSelect(): HTMLSelectElement {
  // The toolbar also has combobox-role inputs (SelectSearch / ShowColumns),
  // so target the native <select> inside the table body specifically.
  const select = document.querySelector<HTMLSelectElement>('tbody select')
  if (!select) throw new Error('No status <select> found in tbody')
  return select
}

function getTabButton(status: string) {
  return screen.getByRole('button', { name: STATUS_TAB_LABEL[status] })
}

describe('ClientsTable', () => {
  it('renders without crashing', () => {
    expect(() => render(<ClientsTable data={[]} user={null} />)).not.toThrow()
  })

  it('status change updates the select value', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)

    const select = getStatusSelect()
    expect(select).toHaveValue('new')

    fireEvent.change(select, { target: { value: 'contacted' } })

    // Select is controlled by state; after the change the visible value is 'contacted'.
    // (The Table remounts on key change, so always re-query the DOM.)
    expect(getStatusSelect()).toHaveValue('contacted')
  })

  it('lead moves between tabs when its status changes', () => {
    render(<ClientsTable data={[makeLead({ name: 'Alice' })]} user={null} leads={true} />)

    // Starts in the "new" tab with the row visible.
    expect(screen.getByText('Alice')).toBeInTheDocument()

    // Change status to "contacted" — active tab should auto-switch and row follows.
    fireEvent.change(getStatusSelect(), { target: { value: 'contacted' } })

    // Row is now under the "contacted" tab.
    expect(screen.getByText('Alice')).toBeInTheDocument()
    const contactedTab = getTabButton('contacted')
    // Count badge inside the "contacted" tab button should read "1".
    expect(within(contactedTab).getByText('1')).toBeInTheDocument()

    // Navigate back to "new" — row should no longer be visible there.
    fireEvent.click(getTabButton('new'))
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()

    // Navigate to "contacted" — row is visible again.
    fireEvent.click(getTabButton('contacted'))
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('does not crash on rapid successive status changes', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)

    expect(() => {
      fireEvent.change(getStatusSelect(), { target: { value: 'contacted' } })
      fireEvent.change(getStatusSelect(), { target: { value: 'closed' } })
      fireEvent.change(getStatusSelect(), { target: { value: 'interested' } })
    }).not.toThrow()

    // Final state: select reflects the last change and the app is still mounted.
    expect(getStatusSelect()).toHaveValue('interested')
  })

  it('re-renders table when tab changes (key remount)', () => {
    // Guards the `<Table key={filteredData.length + '-' + activeTab} />` fix:
    // switching tabs must change the key, forcing a fresh <table> DOM node.
    render(<ClientsTable data={[]} user={null} leads={true} />)

    const initialTable = document.querySelector('table')
    expect(initialTable).toBeInTheDocument()

    fireEvent.click(getTabButton('contacted'))

    const newTable = document.querySelector('table')
    expect(newTable).toBeInTheDocument()
    expect(newTable).not.toBe(initialTable)
  })
})
