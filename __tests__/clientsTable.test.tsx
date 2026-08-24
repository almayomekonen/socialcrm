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
 * Live workspace search.
 *
 * The table IS the result: typing narrows it. The search box is the only place
 * the term appears, the URL carries it to the server, and exactly one history
 * entry is created per search session no matter how many characters are typed.
 */
describe('ClientsTable — live workspace search', () => {
  // `details` carries the national id (generated as
  // firstName || ' ' || lastName || ' (' || idNum || ')'), which is precisely
  // why it must never become the search term or the input's value.
  const SEFI = { id: 7, firstName: 'ספי', lastName: 'ברהנה', details: 'ספי ברהנה (123456789)' }
  const OTHER = { id: 9, firstName: 'ספי', lastName: 'מזרחי', details: 'ספי מזרחי (987654321)' }

  const box = () => screen.getAllByRole('combobox')[0] as HTMLInputElement

  function typeText(term: string, results = [SEFI, OTHER]) {
    vi.mocked(searchLeads).mockResolvedValue(results as never)
    vi.mocked(searchContacts).mockResolvedValue(results as never)
    fireEvent.change(box(), { target: { value: term } })
  }

  const lastNav = () => (routerPush.mock.calls.at(-1) ?? routerReplace.mock.calls.at(-1))!
  const navParams = () => new URLSearchParams((lastNav()[0] as string).replace(/^\?/, ''))

  // ── A. live typing ────────────────────────────────────────────────────────

  it('the FIRST character produces a q — no two-character floor', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ס')

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    expect(navParams().get('q')).toBe('ס')
  })

  it('the input never lags — its value updates before any navigation', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ספ')

    // Synchronously, in the same tick as the keystroke.
    expect(box().value).toBe('ספ')
    expect(routerPush).not.toHaveBeenCalled()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('debounce collapses a burst of keystrokes into ONE navigation', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ס')
    typeText('ספ')
    typeText('ספי')
    typeText('ספי ברהנה')

    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1))
    expect(routerReplace).not.toHaveBeenCalled()
    expect(navParams().get('q')).toBe('ספי ברהנה')
  })

  it('a multi-word term reaches the server intact', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ספי ברהנה')

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    expect(navParams().get('q')).toBe('ספי ברהנה')
  })

  // ── B. history ────────────────────────────────────────────────────────────

  it('PUSHES exactly once on empty → non-empty', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ס')

    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1))
    expect(routerPush.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('REPLACES on non-empty → different non-empty', async () => {
    url.search = 'q=%D7%A1'
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ספי')

    await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1))
    expect(routerPush).not.toHaveBeenCalled()
    expect(routerReplace.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('REPLACES on non-empty → empty, and does so immediately', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99&tableLimit=500'
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.change(box(), { target: { value: '' } })

    // No debounce wait: getting your workspace back must feel instant.
    expect(routerReplace).toHaveBeenCalledTimes(1)
    expect(routerPush).not.toHaveBeenCalled()
    const next = new URLSearchParams((routerReplace.mock.calls[0][0] as string).replace(/^\?/, ''))
    expect(next.get('q')).toBeNull()
    expect(next.get('tableLimit')).toBe('500')
  })

  it('never stacks history — one push, then only replaces', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ס')
    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1))

    url.search = 'q=%D7%A1'
    typeText('ספי')
    await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1))

    expect(routerPush).toHaveBeenCalledTimes(1)
  })

  it('focusing an already-empty box never navigates', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '' } })

    expect(routerPush).not.toHaveBeenCalled()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('retyping the term already in the URL does not navigate', async () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ספי')

    await new Promise((r) => setTimeout(r, 400))
    expect(routerPush).not.toHaveBeenCalled()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  // ── C. autocomplete as accelerator ────────────────────────────────────────

  it('suggestions are still offered while typing', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.focus(box())
    typeText('ספי')

    expect(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' })).toBeInTheDocument()
  })

  it('clicking a suggestion commits its name immediately, skipping the debounce', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.focus(box())
    typeText('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי מזרחי (987654321)' }))

    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(navParams().get('q')).toBe('ספי מזרחי')
  })

  it('a highlighted suggestion + Enter commits that name', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.focus(box())
    typeText('ספי')
    await screen.findByRole('listbox')

    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: 'Enter' })

    expect(navParams().get('q')).toBe('ספי ברהנה')
  })

  it('plain Enter commits the typed text, no suggestion required', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.focus(box())
    typeText('ספי')
    await screen.findByRole('listbox')

    fireEvent.keyDown(box(), { key: 'Enter' })

    expect(navParams().get('q')).toBe('ספי')
  })

  it('a chosen suggestion never puts idNum in the input or the URL', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.focus(box())
    typeText('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' }))

    expect(box().value).toBe('ספי ברהנה')
    expect(box().value).not.toContain('123456789')
    expect(lastNav()[0]).not.toContain('123456789')
    expect(navParams().get('q')).toBe('ספי ברהנה')
  })

  it('never writes clientId', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    fireEvent.focus(box())
    typeText('ספי')
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ספי ברהנה (123456789)' }))

    expect(lastNav()[0]).not.toContain('clientId')
    expect(lastNav()[0]).not.toContain('clientDetails')
  })

  // ── D. URL synchronisation ────────────────────────────────────────────────

  it('an initial ?q= populates the input on mount', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99%20%D7%91%D7%A8%D7%94%D7%A0%D7%94'
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    expect(box().value).toBe('ספי ברהנה')
  })

  it('an EXTERNAL url change (back/forward) updates the input', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    const { rerender } = render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    expect(box().value).toBe('ספי')

    url.search = ''
    rerender(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    expect(box().value).toBe('')
  })

  it('the url echoing our OWN search back does not disturb the typed text', async () => {
    const { rerender } = render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    typeText('ספי')
    await waitFor(() => expect(routerPush).toHaveBeenCalled())

    // The server re-render lands with our own term in the URL, while the user
    // has already typed further. The box must keep what they typed.
    typeText('ספי ב')
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    rerender(<ClientsTable data={[makeLead()]} user={null} leads={true} />)

    expect(box().value).toBe('ספי ב')
  })

  // ── E. table + empty states ───────────────────────────────────────────────

  it('the table renders whatever the server returned for the term', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead({ id: 7, name: 'ספי ברהנה' }), makeLead({ id: 9, name: 'ספי מזרחי' })]} user={null} leads={true} />)

    expect(screen.getByText('ספי ברהנה')).toBeInTheDocument()
    expect(screen.getByText('ספי מזרחי')).toBeInTheDocument()
  })

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

  // ── result count ──────────────────────────────────────────────────────────

  it('shows a compact result count beside the input while searching', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead({ id: 7 }), makeLead({ id: 9 })]} user={null} leads={true} />)
    expect(screen.getByText('2 תוצאות')).toBeInTheDocument()
  })

  it('singularises one result', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead({ id: 7 })]} user={null} leads={true} />)
    expect(screen.getByText('תוצאה אחת')).toBeInTheDocument()
  })

  it('shows NO count when the workspace is unfiltered', () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={true} />)
    expect(screen.queryByText(/תוצא/)).not.toBeInTheDocument()
  })

  it('does not repeat the search term anywhere outside the input', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead({ id: 7, name: 'אחר' })]} user={null} leads={true} />)

    // The old chip echoed the term above the tabs; the box is now the only place.
    expect(screen.queryByText(/חיפוש: /)).not.toBeInTheDocument()
    expect(screen.getAllByDisplayValue('ספי')).toHaveLength(1)
  })

  // ── F. tabs ───────────────────────────────────────────────────────────────

  it('opens the status tab that actually holds the results', async () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    const { rerender } = render(<ClientsTable data={[]} user={null} leads={true} />)
    rerender(<ClientsTable data={[makeLead({ id: 7, name: 'ספי ברהנה', status: 'contacted' })]} user={null} leads={true} />)

    await waitFor(() => expect(screen.getByText('ספי ברהנה')).toBeInTheDocument())
  })

  it('leaves the tab alone when it still holds results', async () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(
      <ClientsTable
        data={[makeLead({ id: 7, name: 'ספי חדש', status: 'new' }), makeLead({ id: 9, name: 'ספי בטיפול', status: 'contacted' })]}
        user={null}
        leads={true}
      />,
    )

    await waitFor(() => expect(screen.getByText('ספי חדש')).toBeInTheDocument())
    expect(screen.queryByText('ספי בטיפול')).not.toBeInTheDocument()
  })

  it('respects a manual tab choice and never overrides it again', async () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    const { rerender } = render(<ClientsTable data={[makeLead({ id: 9, name: 'ספי בטיפול', status: 'contacted' })]} user={null} leads={true} />)
    await waitFor(() => expect(screen.getByText('ספי בטיפול')).toBeInTheDocument())

    // The rep deliberately moves to an empty tab…
    fireEvent.click(screen.getByRole('button', { name: /^מעוניין\b/ }))
    expect(screen.queryByText('ספי בטיפול')).not.toBeInTheDocument()

    // …and a further result set must not bounce them out of it.
    rerender(<ClientsTable data={[makeLead({ id: 9, name: 'ספי בטיפול', status: 'contacted' })]} user={null} leads={true} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('ספי בטיפול')).not.toBeInTheDocument()
  })

  // ── G. /clients ───────────────────────────────────────────────────────────

  it('/clients searches live the same way', async () => {
    render(<ClientsTable data={[makeLead()]} user={null} leads={false} />)
    typeText('ספי')

    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1))
    expect(navParams().get('q')).toBe('ספי')
    expect(lastNav()[0]).not.toContain('clientId')
    expect(routerPush.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('/clients shows the result count too', () => {
    url.search = 'q=%D7%A1%D7%A4%D7%99'
    render(<ClientsTable data={[makeLead({ id: 7 })]} user={null} leads={false} />)
    expect(screen.getByText('תוצאה אחת')).toBeInTheDocument()
  })
})
