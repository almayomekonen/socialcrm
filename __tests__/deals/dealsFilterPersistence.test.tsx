// @vitest-environment jsdom
//
// The remembered ACTIVE /deals filter, on the shared section-aware mechanism
// (lib/filter/activeFilter). Precedence: explicit URL filter > remembered deals
// filter > default. Deals and Performance never touch each other's value.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/deals',
  serverCookies: new Map<string, string>(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: H.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => H.pathname,
  redirect: vi.fn(),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (H.serverCookies.has(name) ? { value: H.serverCookies.get(name) } : undefined) }),
}))
vi.mock('@/actions/filter', () => ({ addSavedFilters: vi.fn() }))

import {
  activeFilterCookie,
  clearPersistedFilter,
  filterSectionForPath,
  persistFilter,
  readPersistedFilter,
} from '@/lib/filter/activeFilter'
import { resolveActiveFilter } from '@/lib/filter/resolveActiveFilter'
import { usePersistedActiveFilter } from '@/components/filter/usePersistedActiveFilter'
import FilterBtn from '@/components/filter/FilterBtn'

const ALL_DATES = JSON.stringify({ dateRange: 'כל התאריכים', action: 'מכירה' })
const AUGUST = JSON.stringify({ dateRange: 'מותאם אישית', start: '2026-08-01', end: '2026-08-31', action: 'מכירה' })
const PERF = JSON.stringify({ dateRange: 'השנה הנוכחית', action: 'מכירה' })

function clearAllCookies() {
  for (const c of document.cookie.split('; ').filter(Boolean)) document.cookie = `${c.split('=')[0]}=; Path=/; Max-Age=0`
}

beforeEach(() => {
  clearAllCookies()
  H.pathname = '/deals'
  H.serverCookies.clear()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('sections', () => {
  it('/deals is its own section; other pages have none', () => {
    expect(filterSectionForPath('/deals')).toBe('deals')
    expect(filterSectionForPath('/sum_sales')).toBe('performance')
    expect(filterSectionForPath('/leads')).toBeNull()
    expect(filterSectionForPath('/deals/other')).toBeNull()
  })

  it('deals and performance use different cookies, per user', () => {
    expect(activeFilterCookie('deals', 1)).toBe('deals_filter_1')
    expect(activeFilterCookie('performance', 1)).toBe('sum_sales_filter_1') // unchanged name
    expect(activeFilterCookie('deals', 1)).not.toBe(activeFilterCookie('deals', 2))
  })
})

describe('precedence (server render of /deals)', () => {
  it('explicit URL filter wins over the remembered deals filter', async () => {
    H.serverCookies.set(activeFilterCookie('deals', 1), encodeURIComponent(ALL_DATES))
    expect(await resolveActiveFilter('deals', 1, AUGUST)).toBe(AUGUST)
  })

  it('bare /deals renders the remembered deals filter', async () => {
    H.serverCookies.set(activeFilterCookie('deals', 1), encodeURIComponent(ALL_DATES))
    expect(await resolveActiveFilter('deals', 1, undefined)).toBe(ALL_DATES)
  })

  it('nothing remembered → undefined (the normal default applies)', async () => {
    expect(await resolveActiveFilter('deals', 1, undefined)).toBeUndefined()
  })

  it('malformed remembered value falls back to the default', async () => {
    H.serverCookies.set(activeFilterCookie('deals', 1), '{"dateRange":')
    expect(await resolveActiveFilter('deals', 1, undefined)).toBeUndefined()
  })

  it('another user and the other section are never used', async () => {
    H.serverCookies.set(activeFilterCookie('deals', 2), encodeURIComponent(ALL_DATES))
    H.serverCookies.set(activeFilterCookie('performance', 1), encodeURIComponent(PERF))
    expect(await resolveActiveFilter('deals', 1, undefined)).toBeUndefined()
  })
})

describe('usePersistedActiveFilter on /deals', () => {
  it('remembers the applied filter; a new filter replaces it', () => {
    const { rerender } = renderHook(({ f }) => usePersistedActiveFilter(1, '/deals', f), { initialProps: { f: ALL_DATES } })
    expect(readPersistedFilter('deals', 1)).toBe(ALL_DATES)
    rerender({ f: AUGUST })
    expect(readPersistedFilter('deals', 1)).toBe(AUGUST)
  })

  it('refresh/remount, sidebar return and the post-save redirect (all: bare /deals) restore it', () => {
    renderHook(() => usePersistedActiveFilter(1, '/deals', ALL_DATES)).unmount()
    renderHook(() => usePersistedActiveFilter(1, '/deals', null))
    expect(H.replace).toHaveBeenCalledWith(`/deals?filter=${encodeURIComponent(ALL_DATES)}`, { scroll: false })
  })

  it('an explicit URL filter is not overridden on the client either', () => {
    persistFilter('deals', 1, ALL_DATES)
    renderHook(() => usePersistedActiveFilter(1, '/deals', AUGUST))
    expect(H.replace).not.toHaveBeenCalled()
    expect(readPersistedFilter('deals', 1)).toBe(AUGUST)
  })

  it('deals and performance values are isolated', () => {
    renderHook(() => usePersistedActiveFilter(1, '/sum_sales', PERF))
    renderHook(() => usePersistedActiveFilter(1, '/deals', ALL_DATES))
    expect(readPersistedFilter('performance', 1)).toBe(PERF)
    expect(readPersistedFilter('deals', 1)).toBe(ALL_DATES)
  })

  it('users are isolated', () => {
    renderHook(() => usePersistedActiveFilter(1, '/deals', ALL_DATES))
    expect(readPersistedFilter('deals', 2)).toBeNull()
    renderHook(() => usePersistedActiveFilter(2, '/deals', null))
    expect(H.replace).not.toHaveBeenCalled()
  })
})

describe('reset (FilterBtn eraser) is section-scoped', () => {
  it('on /deals: clears the deals filter only; the default comes back', () => {
    persistFilter('deals', 1, ALL_DATES)
    persistFilter('performance', 1, PERF)
    render(<FilterBtn user={{ id: 1, savedFilters: [] }} filter={JSON.parse(ALL_DATES)} />)
    fireEvent.click(screen.getByRole('link', { name: 'ניקוי סינון' }))
    expect(readPersistedFilter('deals', 1)).toBeNull()
    expect(readPersistedFilter('performance', 1)).toBe(PERF)

    // After reset, bare /deals restores nothing → the normal default.
    renderHook(() => usePersistedActiveFilter(1, '/deals', null))
    expect(H.replace).not.toHaveBeenCalled()
  })

  it('on /sum_sales: clears the performance filter only', () => {
    H.pathname = '/sum_sales'
    persistFilter('deals', 1, ALL_DATES)
    persistFilter('performance', 1, PERF)
    render(<FilterBtn user={{ id: 1, savedFilters: [] }} filter={JSON.parse(PERF)} />)
    fireEvent.click(screen.getByRole('link', { name: 'ניקוי סינון' }))
    expect(readPersistedFilter('performance', 1)).toBeNull()
    expect(readPersistedFilter('deals', 1)).toBe(ALL_DATES)
  })

  it('on an unrelated page: clears nothing', () => {
    H.pathname = '/leads'
    persistFilter('deals', 1, ALL_DATES)
    render(<FilterBtn user={{ id: 1, savedFilters: [] }} filter={{}} />)
    fireEvent.click(screen.getByRole('link', { name: 'ניקוי סינון' }))
    expect(readPersistedFilter('deals', 1)).toBe(ALL_DATES)
    clearPersistedFilter('deals', 1)
  })
})
