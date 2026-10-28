// @vitest-environment jsdom
//
// `/leads?add=1` and `/leads?import=1` — the Today hero's "הוסף ליד" / "ייבוא Excel"
// buttons land here. The hook opens the matching existing dialog once and strips
// the param (History API, no server re-render), so a refresh does not reopen it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

const replace = vi.spyOn(window.history, 'replaceState')
let query = ''

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(query),
}))

import { useOpenDialogFromQuery } from '@/components/clients/hooks/useOpenDialogFromQuery'

const openAdd = vi.fn()
const openImport = vi.fn()

function Probe({ enabled = true }: { enabled?: boolean }) {
  useOpenDialogFromQuery({ enabled, openAdd, openImport })
  return null
}

beforeEach(() => {
  replace.mockClear()
  openAdd.mockClear()
  openImport.mockClear()
})
afterEach(() => cleanup())

describe('useOpenDialogFromQuery', () => {
  it('?add=1 opens the add-lead form and strips the param, keeping others', () => {
    query = 'add=1&q=דני'
    render(<Probe />)
    expect(openAdd).toHaveBeenCalledTimes(1)
    expect(openImport).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(null, '', `/leads?q=${encodeURIComponent('דני')}`)
  })

  it('?import=1 opens the upload dialog', () => {
    query = 'import=1'
    render(<Probe />)
    expect(openImport).toHaveBeenCalledTimes(1)
    expect(openAdd).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(null, '', '/leads')
  })

  it('fires once across re-renders', () => {
    query = 'add=1'
    const { rerender } = render(<Probe />)
    rerender(<Probe />)
    expect(openAdd).toHaveBeenCalledTimes(1)
  })

  it('does nothing without the params, or when disabled (contacts table)', () => {
    query = 'q=x'
    render(<Probe />)
    query = 'add=1'
    render(<Probe enabled={false} />)
    expect(openAdd).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})
