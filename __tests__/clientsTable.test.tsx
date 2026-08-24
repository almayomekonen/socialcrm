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

// Per-test URL control: the search scope (`?clientId=`) lives in the URL, and
// the table's empty state and opening tab both read it.
const url = { search: '' }
const routerReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(url.search),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, refresh: vi.fn() }),
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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { redirect } from 'next/navigation'
import { searchLeads } from '@/actions/clients'
import ClientsTable from '@/components/clients/clientsTable'

afterEach(() => {
  cleanup()
  url.search = ''
  routerReplace.mockClear()
  vi.mocked(redirect).mockClear()
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

describe('source badge — the internal composite never reaches the screen', () => {
  // The bug this guards: a website lead rendered its raw storage identity,
  // `contact_form_7:3:c1e76529-dddb-407a-b0a4-3110089b0da4`, in the מקור column.
  const WEBSITE_SOURCE = 'contact_form_7:3:c1e76529-dddb-407a-b0a4-3110089b0da4'

  it('a website lead displays אתר, not the connection row or submission id', () => {
    render(<ClientsTable data={[makeLead({ leadSource: WEBSITE_SOURCE })]} user={null} leads={true} />)

    const body = document.querySelector('tbody')!
    expect(within(body).getByText('אתר')).toBeInTheDocument()
    expect(body.textContent).not.toContain('contact_form_7')
    expect(body.textContent).not.toContain('c1e76529')
  })

  it('Facebook and WhatsApp labels are unchanged', () => {
    render(
      <ClientsTable
        data={[
          makeLead({ id: 1, name: 'FB', leadSource: 'facebook:1557473805865751' }),
          makeLead({ id: 2, name: 'WA', leadSource: 'whatsapp:wamid.HBgMOTcyNTM3NzM2NjM2' }),
        ]}
        user={null}
        leads={true}
      />,
    )

    const body = document.querySelector('tbody')!
    expect(within(body).getByText('Facebook')).toBeInTheDocument()
    expect(within(body).getByText('WhatsApp')).toBeInTheDocument()
    expect(body.textContent).not.toContain('1557473805865751')
    expect(body.textContent).not.toContain('wamid')
  })
})

/**
 * Search scope — the regression suite for "the workspace discarded its leads".
 *
 * Picking a lead out of the toolbar search puts `?clientId=` in the URL and the
 * server narrows the query to that one row. Three things then had to be true and
 * were not: the row had to survive the status tab, zero rows had to read as
 * "this search matched nothing" rather than "you have no לידים", and emptying
 * the box had to drop the scope.
 */
describe('ClientsTable — search scope', () => {
  it('scoped zero results render the filtered-empty state, never first-run', () => {
    url.search = 'clientId=12&clientDetails=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[]} user={null} leads={true} />)

    expect(screen.getByText('לא נמצאו לידים מתאימים')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /נקה חיפוש/ })).toBeInTheDocument()
    // The false claim this whole fix exists to stop.
    expect(screen.queryByText('אין עדיין לידים')).not.toBeInTheDocument()
    expect(screen.queryByText('חבר פייסבוק או הוסף ליד ידנית')).not.toBeInTheDocument()
  })

  it('a view scope with zero results is also filtered-empty, not first-run', () => {
    url.search = 'view=due'
    render(<ClientsTable data={[]} user={null} leads={true} />)

    expect(screen.getByText('לא נמצאו לידים מתאימים')).toBeInTheDocument()
    expect(screen.queryByText('אין עדיין לידים')).not.toBeInTheDocument()
  })

  it('the way out of a view/list scope actually lifts it — not a dead button', () => {
    // `/leads?view=due` is a real destination (dashboard QuickLinks), so its
    // empty state needs an escape that clears more than the search box.
    url.search = 'view=due&listId=3'
    render(<ClientsTable data={[]} user={null} leads={true} />)

    fireEvent.click(screen.getByRole('button', { name: /הצג את כל הלידים/ }))

    expect(routerReplace).toHaveBeenCalledTimes(1)
    const target = routerReplace.mock.calls[0][0] as string
    expect(target).not.toContain('view')
    expect(target).not.toContain('listId')
  })

  it('a mobile ?q= URL opened on desktop is NOT treated as a scope (desktop ignores q)', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[]} user={null} leads={true} />)

    expect(screen.getByText('אין עדיין לידים')).toBeInTheDocument()
  })

  it('an UNSCOPED empty table still renders the legitimate first-run state', () => {
    render(<ClientsTable data={[]} user={null} leads={true} />)

    expect(screen.getByText('אין עדיין לידים')).toBeInTheDocument()
    expect(screen.getByText('חבר פייסבוק או הוסף ליד ידנית')).toBeInTheDocument()
    expect(screen.queryByText('לא נמצאו לידים מתאימים')).not.toBeInTheDocument()
  })

  it('an unparseable clientId is NOT treated as a scope (the query ignores it too)', () => {
    url.search = 'clientId=%D7%A1%D7%A4%D7%99%20%D7%91%D7%A8%D7%94%D7%A0%D7%94'
    render(<ClientsTable data={[]} user={null} leads={true} />)

    expect(screen.getByText('אין עדיין לידים')).toBeInTheDocument()
  })

  it('a searched CONTACTED lead is visible — the tab opens on its status', () => {
    url.search = 'clientId=7'
    render(<ClientsTable data={[makeLead({ id: 7, name: 'ספי ברהנה', status: 'contacted' })]} user={null} leads={true} />)

    expect(screen.getByText('ספי ברהנה')).toBeInTheDocument()
    expect(within(getTabButton('contacted')).getByText('1')).toBeInTheDocument()
  })

  it('a searched CLOSED lead is visible', () => {
    url.search = 'clientId=7'
    render(<ClientsTable data={[makeLead({ id: 7, name: 'עסקה סגורה', status: 'closed' })]} user={null} leads={true} />)

    expect(screen.getByText('עסקה סגורה')).toBeInTheDocument()
  })

  it.each(['interested', 'lost', 'new'])('a searched %s lead is visible', (status) => {
    url.search = 'clientId=7'
    render(<ClientsTable data={[makeLead({ id: 7, name: 'ליד מבוקש', status })]} user={null} leads={true} />)

    expect(screen.getByText('ליד מבוקש')).toBeInTheDocument()
  })

  it('unscoped browsing still opens on the "new" tab', () => {
    render(<ClientsTable data={[makeLead({ name: 'ליד חדש שלי', status: 'new' }), makeLead({ id: 2, name: 'ליד בטיפול שלי', status: 'contacted' })]} user={null} leads={true} />)

    expect(screen.getByText('ליד חדש שלי')).toBeInTheDocument()
    expect(screen.queryByText('ליד בטיפול שלי')).not.toBeInTheDocument()
  })

  it('clearing the search input drops clientId from the URL', () => {
    url.search = 'clientId=7&clientDetails=%D7%A1%D7%A4%D7%99&pageNum=2&tableLimit=500'
    render(<ClientsTable data={[makeLead({ id: 7, name: 'ספי ברהנה' })]} user={null} leads={true} />)

    const search = screen.getAllByRole('combobox')[0]
    fireEvent.change(search, { target: { value: '' } })

    expect(routerReplace).toHaveBeenCalledTimes(1)
    const target = routerReplace.mock.calls[0][0] as string
    const next = new URLSearchParams(target.replace(/^\?/, ''))
    expect(next.get('clientId')).toBeNull()
    expect(next.get('clientDetails')).toBeNull()
    expect(next.get('pageNum')).toBeNull()
    // Unrelated params survive.
    expect(next.get('tableLimit')).toBe('500')
  })

  it('the filtered-empty CTA clears the scope', () => {
    url.search = 'clientId=12&clientDetails=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[]} user={null} leads={true} />)

    // The empty state's own button, not the toolbar eraser (a link, not a button).
    const ctas = screen.getAllByRole('button', { name: /נקה חיפוש/ })
    fireEvent.click(ctas[ctas.length - 1])

    expect(routerReplace).toHaveBeenCalledTimes(1)
    expect(routerReplace.mock.calls[0][0]).not.toContain('clientId')
    expect(routerReplace.mock.calls[0][0]).not.toContain('clientDetails')
  })

  it('picking a search result drops the stale page offset from the URL', async () => {
    url.search = 'pageNum=3&tableLimit=100'
    vi.mocked(searchLeads).mockResolvedValueOnce([{ id: 7, details: 'ספי ברהנה' }] as never)
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)

    const search = screen.getAllByRole('combobox')[0]
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'ספי' } })
    const option = await screen.findByRole('option', { name: 'ספי ברהנה' })

    fireEvent.mouseDown(option)

    await waitFor(() => expect(redirect).toHaveBeenCalled())
    const target = vi.mocked(redirect).mock.calls.at(-1)![0] as string
    const next = new URLSearchParams(target.replace(/^\?/, ''))
    expect(next.get('clientId')).toBe('7')
    expect(next.get('pageNum')).toBeNull()
    expect(next.get('tableLimit')).toBe('100')
  })

  it('focusing an already-empty search box never navigates', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)

    const search = screen.getAllByRole('combobox')[0]
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: '' } })

    expect(routerReplace).not.toHaveBeenCalled()
  })
})
