// @vitest-environment jsdom
//
// Mobile Leads filter bar — visual contract without dropping behaviour.
//
// Active filters stay clearable (individually and all-at-once), the count
// badge stays, search still commits on submit. The chrome is toolbar text,
// not a floating pill collection.

import { afterEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: () => {}, refresh: () => {} }),
  usePathname: () => '/leads',
}))

import LeadFilterBar from '@/modules/leads/mobile/LeadFilterBar'
import LeadCardMobile from '@/modules/leads/mobile/LeadCardMobile'
import type { MobileLeadRow } from '@/modules/leads/queries'

afterEach(() => {
  cleanup()
  push.mockClear()
})

describe('LeadFilterBar — toolbar, not pills', () => {
  test('search, filter count, individual clear and clear-all are all present', () => {
    render(<LeadFilterBar filters={{ q: 'דני', status: ['contacted'] }} resultCount={2} />)
    expect(screen.getByRole('search')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'סינון לפי סטטוס, 1 נבחרו' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'הסר בטיפול' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'נקה חיפוש' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'נקה הכל' })).toBeTruthy()
    expect(screen.getByText('2 לידים')).toBeTruthy()
  })

  test('an active filter is not a rounded capsule', () => {
    render(<LeadFilterBar filters={{ q: '', status: ['contacted'] }} resultCount={2} />)
    const chip = screen.getByRole('button', { name: 'הסר בטיפול' })
    const cls = chip.className.split(/\s+/)
    expect(cls).not.toContain('rounded-full')
    expect(cls).not.toContain('bg-gray-50')
    expect(cls).not.toContain('border-gray-200')
    expect(cls).toContain('h-11')
  })

  test('the count badge stays a numeric badge on the filter button', () => {
    render(<LeadFilterBar filters={{ q: '', status: ['contacted', 'new'] }} resultCount={4} />)
    expect(screen.getByRole('button', { name: 'סינון לפי סטטוס, 2 נבחרו' })).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  test('clearing one status navigates without that status', () => {
    render(<LeadFilterBar filters={{ q: '', status: ['contacted'] }} resultCount={2} />)
    fireEvent.click(screen.getByRole('button', { name: 'הסר בטיפול' }))
    expect(push).toHaveBeenCalledWith('/leads')
  })

  test('נקה הכל clears search and status', () => {
    render(<LeadFilterBar filters={{ q: 'דני', status: ['contacted'] }} resultCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'נקה הכל' }))
    expect(push).toHaveBeenCalledWith('/leads')
  })

  test('search submit navigates with q', () => {
    render(<LeadFilterBar filters={{ q: '', status: [] }} resultCount={30} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'שירה' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(push).toHaveBeenCalledWith(`/leads?${new URLSearchParams({ q: 'שירה' }).toString()}`)
  })

  test('with no filters, clear-all and active filters are absent', () => {
    render(<LeadFilterBar filters={{ q: '', status: [] }} resultCount={30} />)
    expect(screen.queryByRole('button', { name: 'נקה הכל' })).toBeNull()
    expect(screen.getByRole('button', { name: 'סינון לפי סטטוס' })).toBeTruthy()
  })

  test('search and filter share one row; active filters sit below', () => {
    render(<LeadFilterBar filters={{ q: '', status: ['contacted', 'new'] }} resultCount={4} />)
    const row = screen.getByTestId('lead-search-filter-row')
    const search = screen.getByRole('search')
    const filterBtn = screen.getByRole('button', { name: /סינון לפי סטטוס/ })
    const strip = screen.getByTestId('lead-active-filters')
    expect(row.contains(search)).toBe(true)
    expect(row.contains(filterBtn)).toBe(true)
    expect(row.contains(strip)).toBe(false)
    expect(strip.className).toContain('overflow-x-auto')
    expect(strip.contains(screen.getByRole('button', { name: 'נקה הכל' }))).toBe(true)
  })
})

describe('LeadCardMobile — status stays, capsule chrome does not', () => {
  const lead = {
    id: 1,
    name: 'אורי ברוך',
    phone: '0500000000',
    waPhone: null,
    email: null,
    status: 'contacted',
    sourceLabel: 'WhatsApp',
    sourceChannel: 'whatsapp',
    nextFollowUpAt: null,
    lastActivityAt: null,
    createdAt: new Date().toISOString(),
    nextAction: null,
    severity: null,
    isNewBadge: false,
    handlerName: null,
  } as unknown as MobileLeadRow

  test('בטיפול remains visible', () => {
    render(<LeadCardMobile lead={lead} followUp={null} />)
    expect(screen.getByText('בטיפול')).toBeTruthy()
  })
})
