// @vitest-environment jsdom
//
// An admin's sales filter with no date range is served the current month by the
// server (db/filter.ts). The chips read the URL, so that default used to be
// invisible: admins saw "no active filters" over a table limited to this month,
// and earlier deals looked deleted. The chips now show it, and removing it means
// "all dates" — a plain removal would just get the month re-applied.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({ replace: vi.fn(), formatSqlFilter: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: H.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/deals',
  redirect: vi.fn(),
}))
vi.mock('@/actions/filter', () => ({ addSavedFilters: vi.fn() }))
vi.mock('@/config/db', () => ({ db: vi.fn() }))
vi.mock('@/db/usersNTeams', () => ({ getUsersAndTeams: async () => ({ users: [], teams: [] }), getExtUsers: async () => [] }))
vi.mock('@/components/filter/formatFilter', () => ({ formatSqlFilter: H.formatSqlFilter }))

import { FilterChips } from '@/components/sumSales/FilterChips'
import { getPermsAndFilter } from '@/db/filter'
import { withAdminDefaultDateRange, withoutDateRange } from '@/lib/filter/adminDefaultDateRange'
import { Roles } from '@/types/roles'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function lastReplacedFilter() {
  const url: string = H.replace.mock.calls.at(-1)?.[0]
  return JSON.parse(url.replace('?filter=', ''))
}

describe('the client default matches the server default', () => {
  // Admins only: the non-admin path reads user_perms, and adds no date range.
  it.each([{}, { action: 'מכירה' }, { dateRange: 'השנה הנוכחית' }])('ADMIN with %j', async (filter) => {
    const { rawFilter } = await getPermsAndFilter({ user: { id: 1, role: Roles.ADMIN } as any, filter: JSON.stringify(filter) })
    expect(withAdminDefaultDateRange(filter, Roles.ADMIN)).toEqual(rawFilter)
  })

  it.each([Roles.AGNT, Roles.MNGR, Roles.OFFICE, undefined])('%s gets no default', (role) => {
    expect(withAdminDefaultDateRange({ action: 'מכירה' }, role)).toEqual({ action: 'מכירה' })
  })
})

describe('chips', () => {
  it('an admin with no date range sees the current-month chip', () => {
    render(<FilterChips filter={{}} role={Roles.ADMIN} />)
    expect(screen.getByText('סינונים פעילים:')).toBeInTheDocument()
    expect(screen.getByText('ת.פנייה')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הסרת סינון ת.פנייה' })).toBeInTheDocument()
  })

  it('a non-admin with no filter sees no chips (no default is applied)', () => {
    const { container } = render(<FilterChips filter={{}} role={Roles.AGNT} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('an admin removing the date chip gets all dates, not the month again', () => {
    render(<FilterChips filter={{ action: 'מכירה' }} role={Roles.ADMIN} />)
    fireEvent.click(screen.getByRole('button', { name: 'הסרת סינון ת.פנייה' }))
    expect(lastReplacedFilter()).toEqual({ action: 'מכירה', dateRange: 'כל התאריכים' })
  })

  it('a non-admin removing a custom date range drops it entirely', () => {
    render(<FilterChips filter={{ dateRange: 'מותאם אישית', start: '2026-08-01', end: '2026-08-31' }} role={Roles.AGNT} />)
    fireEvent.click(screen.getByRole('button', { name: 'הסרת סינון ת.פנייה' }))
    expect(lastReplacedFilter()).toEqual({})
  })

  it('removing another chip keeps the date range the admin is looking at', () => {
    render(<FilterChips filter={{ action: 'מכירה' }} role={Roles.ADMIN} />)
    fireEvent.click(screen.getByRole('button', { name: 'הסרת סינון פעולה' }))
    expect(lastReplacedFilter()).toEqual({ dateRange: 'החודש הנוכחי' })
  })
})

describe('withoutDateRange', () => {
  it('clears custom start/end too', () => {
    expect(withoutDateRange({ dateRange: 'מותאם אישית', start: 'a', end: 'b', status: ['x'] } as any, Roles.ADMIN)).toEqual({
      status: ['x'],
      dateRange: 'כל התאריכים',
    })
  })
})
