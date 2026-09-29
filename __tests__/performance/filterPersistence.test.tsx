// @vitest-environment jsdom
//
// The remembered ACTIVE Performance filter: a Performance page opened without
// `?filter=` (sidebar link, typed URL, new tab) comes back with the user's last
// applied filter; reset forgets it; users never share it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/sum_sales',
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
  clearPersistedFilter,
  isPerformanceFilterPath,
  parsePersistedFilter,
  performanceFilterCookie,
  persistFilter,
  readPersistedFilter,
} from '@/lib/filter/performanceFilter'
import { resolvePerformanceFilter } from '@/lib/filter/resolvePerformanceFilter'
import { usePersistedPerformanceFilter } from '@/components/sumSales/usePersistedPerformanceFilter'
import FilterBtn from '@/components/filter/FilterBtn'

const AUGUST = JSON.stringify({ dateRange: 'מותאם אישית', start: '2026-08-01', end: '2026-08-31', userIds: [7], userNames: ['דנה'], action: 'מכירה' })
const SEPTEMBER = JSON.stringify({ dateRange: 'החודש הנוכחי', action: 'מכירה' })

function clearAllCookies() {
  for (const c of document.cookie.split('; ').filter(Boolean)) {
    document.cookie = `${c.split('=')[0]}=; Path=/; Max-Age=0`
  }
}

beforeEach(() => {
  clearAllCookies()
  H.pathname = '/sum_sales'
  H.serverCookies.clear()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('persisted value parsing', () => {
  it('accepts the filter object the panel writes, raw or URI-encoded', () => {
    expect(parsePersistedFilter(AUGUST)).toBe(AUGUST)
    expect(parsePersistedFilter(encodeURIComponent(AUGUST))).toBe(AUGUST)
  })

  it('falls back (null) for malformed, stale-shaped or oversized values', () => {
    for (const bad of [undefined, '', '{"dateRange":', 'not json', '[1,2]', 'null', '"x"', '42', '%E0%A4%A', '{"a":"' + 'x'.repeat(4000) + '"}']) {
      expect(parsePersistedFilter(bad), String(bad).slice(0, 20)).toBeNull()
    }
  })

  it('is scoped to Performance pages only (not ads, not deals)', () => {
    expect(isPerformanceFilterPath('/sum_sales')).toBe(true)
    expect(isPerformanceFilterPath('/sum_sales/months')).toBe(true)
    expect(isPerformanceFilterPath('/sum_sales/ads')).toBe(false)
    expect(isPerformanceFilterPath('/deals')).toBe(false)
    expect(isPerformanceFilterPath('/sum_salesX')).toBe(false)
  })
})

describe('browser storage', () => {
  it('is readable wherever the restore effect runs, including right after a client navigation', () => {
    persistFilter(1, AUGUST)
    window.history.replaceState(null, '', '/deals')
    expect(readPersistedFilter(1)).toBe(AUGUST)
    window.history.replaceState(null, '', '/')
  })

  it('stores per user: another user in the same browser never reads it', () => {
    persistFilter(1, AUGUST)
    expect(readPersistedFilter(1)).toBe(AUGUST)
    expect(readPersistedFilter(2)).toBeNull()
    expect(performanceFilterCookie(1)).not.toBe(performanceFilterCookie(2))
  })

  it('a new filter replaces the previous one; clear forgets it', () => {
    persistFilter(1, AUGUST)
    persistFilter(1, SEPTEMBER)
    expect(readPersistedFilter(1)).toBe(SEPTEMBER)
    clearPersistedFilter(1)
    expect(readPersistedFilter(1)).toBeNull()
  })

  it('never stores a malformed filter', () => {
    persistFilter(1, '{broken')
    expect(readPersistedFilter(1)).toBeNull()
  })
})

describe('server resolution (page render)', () => {
  it('the URL filter always wins', async () => {
    H.serverCookies.set(performanceFilterCookie(1), encodeURIComponent(AUGUST))
    expect(await resolvePerformanceFilter(1, SEPTEMBER)).toBe(SEPTEMBER)
  })

  it('without ?filter= it reconstructs the remembered filter for THIS user only', async () => {
    H.serverCookies.set(performanceFilterCookie(1), encodeURIComponent(AUGUST))
    expect(await resolvePerformanceFilter(1, undefined)).toBe(AUGUST)
    expect(await resolvePerformanceFilter(2, undefined)).toBeUndefined()
  })

  it('malformed stored state falls back to the defaults (undefined)', async () => {
    H.serverCookies.set(performanceFilterCookie(1), '{"dateRange":')
    expect(await resolvePerformanceFilter(1, undefined)).toBeUndefined()
  })
})

describe('usePersistedPerformanceFilter', () => {
  it('remembers the applied filter and restores it after a remount without ?filter=', () => {
    const first = renderHook(() => usePersistedPerformanceFilter(1, '/sum_sales', AUGUST))
    expect(readPersistedFilter(1)).toBe(AUGUST)
    first.unmount()

    // Leave and come back: the page mounts with no query string.
    renderHook(() => usePersistedPerformanceFilter(1, '/sum_sales/months', null))
    expect(H.replace).toHaveBeenCalledWith(`/sum_sales/months?filter=${encodeURIComponent(AUGUST)}`, { scroll: false })
  })

  it('a changed filter replaces the remembered one', () => {
    const { rerender } = renderHook(({ f }) => usePersistedPerformanceFilter(1, '/sum_sales', f), { initialProps: { f: AUGUST } })
    rerender({ f: SEPTEMBER })
    expect(readPersistedFilter(1)).toBe(SEPTEMBER)
  })

  it('does nothing outside Performance pages or without a user', () => {
    renderHook(() => usePersistedPerformanceFilter(1, '/deals', AUGUST))
    renderHook(() => usePersistedPerformanceFilter(undefined, '/sum_sales', AUGUST))
    expect(readPersistedFilter(1)).toBeNull()
  })
})

describe('reset control (FilterBtn eraser)', () => {
  it('on Performance: clears the remembered filter, so the defaults come back', () => {
    persistFilter(1, AUGUST)
    render(<FilterBtn user={{ id: 1, savedFilters: [] }} filter={JSON.parse(AUGUST)} />)
    fireEvent.click(screen.getByRole('link', { name: 'ניקוי סינון' }))
    expect(readPersistedFilter(1)).toBeNull()

    // After reset, a remount with no ?filter= restores nothing.
    renderHook(() => usePersistedPerformanceFilter(1, '/sum_sales', null))
    expect(H.replace).not.toHaveBeenCalled()
  })

  it('on another page (e.g. /deals): leaves the Performance filter alone', () => {
    H.pathname = '/deals'
    persistFilter(1, AUGUST)
    render(<FilterBtn user={{ id: 1, savedFilters: [] }} filter={{}} />)
    fireEvent.click(screen.getByRole('link', { name: 'ניקוי סינון' }))
    expect(readPersistedFilter(1)).toBe(AUGUST)
  })
})
