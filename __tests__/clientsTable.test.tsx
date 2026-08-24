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
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(url.search),
  redirect: vi.fn(),
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: vi.fn() }),
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
import { searchContacts, searchLeads } from '@/actions/clients'
import ClientsTable from '@/components/clients/clientsTable'

afterEach(() => {
  cleanup()
  url.search = ''
  routerReplace.mockClear()
  routerPush.mockClear()
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
 * Workspace search — the regression suite for "where did all my leads go?".
 *
 * The toolbar search is a FILTER over the workspace, not a lookup that swaps the
 * workspace for one record. It writes `?q=`, the same parameter the mobile list
 * uses, and the workspace says out loud that it is filtered.
 */
describe('ClientsTable — workspace search', () => {
  // `details` carries the national id (it is generated as
  // firstName || ' ' || lastName || ' (' || idNum || ')'), which is exactly why
  // it must never become the search term.
  const SEFI = { id: 7, firstName: 'ספי', lastName: 'ברהנה', details: 'ספי ברהנה (123456789)' }
  const OTHER = { id: 9, firstName: 'ספי', lastName: 'מזרחי', details: 'ספי מזרחי (987654321)' }

  async function type(term: string, results = [SEFI, OTHER]) {
    vi.mocked(searchLeads).mockResolvedValueOnce(results as never)
    vi.mocked(searchContacts).mockResolvedValueOnce(results as never)
    const search = screen.getAllByRole('combobox')[0]
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: term } })
    return search
  }

  const lastNav = () => (routerPush.mock.calls[0] ?? routerReplace.mock.calls[0])
  const navParams = () => new URLSearchParams((lastNav()[0] as string).replace(/^\?/, ''))

  // ── committing a search ───────────────────────────────────────────────────

  it('typed text + Enter searches for what was typed (partial terms work)', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    const search = await type('ספי')
    await screen.findByRole('listbox')

    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    expect(navParams().get('q')).toBe('ספי')
  })

  it('an explicitly highlighted result + Enter searches that lead by name', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    const search = await type('ספי')
    await screen.findByRole('listbox')

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    expect(navParams().get('q')).toBe('ספי מזרחי')
  })

  it('mouse selection produces exactly what highlighted-Enter produces', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    await type('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי מזרחי (987654321)' }))

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    expect(navParams().get('q')).toBe('ספי מזרחי')
  })

  it('the search term NEVER contains idNum, even though the suggestion shows it', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    await type('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' }))

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    const url = lastNav()[0] as string
    expect(url).not.toContain('123456789')
    expect(navParams().get('q')).toBe('ספי ברהנה')
    expect(navParams().get('clientId')).toBeNull()
  })

  it('never writes clientId — the workspace is filtered, not replaced', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    await type('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' }))

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    const url = lastNav()[0] as string
    expect(url).not.toContain('clientId')
    expect(url).not.toContain('clientDetails')
  })

  // ── URL bookkeeping ──────────────────────────────────────────────────────

  it('resets the page offset and preserves unrelated parameters', async () => {
    url.search = 'pageNum=3&tableLimit=500&listId=4&view=due'
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    await type('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' }))

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    const next = navParams()
    expect(next.get('pageNum')).toBeNull()
    expect(next.get('tableLimit')).toBe('500')
    expect(next.get('listId')).toBe('4')
    expect(next.get('view')).toBe('due')
  })

  // ── history policy ───────────────────────────────────────────────────────

  it('PUSHES when entering a search from an unfiltered workspace', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    const search = await type('ספי')
    await screen.findByRole('listbox')
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1))
    expect(routerReplace).not.toHaveBeenCalled()
    expect(routerPush.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('REPLACES when changing an already-active search', async () => {
    url.search = 'q=%D7%A7%D7%95%D7%93%D7%9D'
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    const search = await type('ספי')
    await screen.findByRole('listbox')
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1))
    expect(routerPush).not.toHaveBeenCalled()
    expect(routerReplace.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('clearing the box uses REPLACE and restores the full workspace', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99&tableLimit=500'
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '' } })

    expect(routerReplace).toHaveBeenCalledTimes(1)
    expect(routerPush).not.toHaveBeenCalled()
    const next = new URLSearchParams((routerReplace.mock.calls[0][0] as string).replace(/^\?/, ''))
    expect(next.get('q')).toBeNull()
    expect(next.get('tableLimit')).toBe('500')
  })

  it('focusing an already-empty search box never navigates', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    const search = screen.getAllByRole('combobox')[0]
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: '' } })

    expect(routerReplace).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  // ── the indicator ────────────────────────────────────────────────────────

  it('shows the active-search chip with term, result count and a clear action', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead({ id: 7, name: 'ספי ברהנה' }), makeLead({ id: 9, name: 'ספי מזרחי' })]} user={null} leads={true} />)

    const chip = screen.getByRole('button', { name: /נקה חיפוש: ספי/ })
    expect(chip).toHaveTextContent('חיפוש: "ספי"')
    expect(screen.getByText('2 לידים')).toBeInTheDocument()

    fireEvent.click(chip)
    expect(routerReplace).toHaveBeenCalledTimes(1)
    expect(routerReplace.mock.calls[0][0]).not.toContain('q=')
  })

  it('the search box shows the committed term, never the idNum-bearing suggestion text', async () => {
    const { rerender } = render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    await type('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' }))

    // The URL is what the workspace is now filtered by; the box must agree.
    url.search = 'q=%D7%A1%D7%A4%D7%99%20%D7%91%D7%A8%D7%94%D7%A0%D7%94'
    rerender(<ClientsTable data={[makeLead({ id: 7, name: 'ספי ברהנה' })]} user={null} leads={true} />)

    const search = screen.getAllByRole('combobox')[0] as HTMLInputElement
    await waitFor(() => expect(search.value).toBe('ספי ברהנה'))
    expect(search.value).not.toContain('123456789')
  })

  it('hides the chip when the workspace is unfiltered', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    expect(screen.queryByRole('button', { name: /נקה חיפוש:/ })).not.toBeInTheDocument()
  })

  // ── the tab follows the results ──────────────────────────────────────────

  it('opens the status tab that actually holds the results', async () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    const { rerender } = render(<ClientsTable data={[]} user={null} leads={true} />)
    rerender(<ClientsTable data={[makeLead({ id: 7, name: 'ספי ברהנה', status: 'contacted' })]} user={null} leads={true} />)

    await waitFor(() => expect(screen.getByText('ספי ברהנה')).toBeInTheDocument())
  })

  // ── empty states ─────────────────────────────────────────────────────────

  it('a search that matched nothing is filtered-empty, never first-run', () => {
    url.search = 'q=%D7%9C%D7%90%D7%A7%D7%99%D7%99%D7%9D'
    render(<ClientsTable data={[]} user={null} leads={true} />)

    expect(screen.getByText('לא נמצאו לידים מתאימים')).toBeInTheDocument()
    expect(screen.queryByText('אין עדיין לידים')).not.toBeInTheDocument()
  })

  it('an UNFILTERED empty table still renders the legitimate first-run state', () => {
    render(<ClientsTable data={[]} user={null} leads={true} />)
    expect(screen.getByText('אין עדיין לידים')).toBeInTheDocument()
  })

  // ── /clients shares the model ────────────────────────────────────────────

  it('/clients uses the same search model — q, never clientId', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={false} />)
    await type('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' }))

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    expect(navParams().get('q')).toBe('ספי ברהנה')
    expect(lastNav()[0]).not.toContain('clientId')
    expect(routerPush.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('/clients shows the chip too', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead()]} user={null} leads={false} />)
    expect(screen.getByRole('button', { name: /נקה חיפוש: ספי/ })).toBeInTheDocument()
  })
})
