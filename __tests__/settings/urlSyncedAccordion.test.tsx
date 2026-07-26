// @vitest-environment jsdom
//
// UrlSyncedAccordion — URL sync on manual open/close. Verifies the sentinel fix:
// closing the open section writes ?section=none (never deletes the param), so the
// server never falls back to its no-param Facebook default. Pure client, no DB.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/settings/facebook',
}))

import UrlSyncedAccordion from '@/lib/UrlSyncedAccordion'

const IDS = ['facebook', 'whatsapp', 'templates'] as const

function Tree() {
  // Mirrors the real page's <details id> items (native exclusive accordion).
  return (
    <UrlSyncedAccordion>
      {IDS.map((id) => (
        <details key={id} id={id}>
          <summary>{id}</summary>
        </details>
      ))}
    </UrlSyncedAccordion>
  )
}

function setUrl(search: string) {
  window.history.replaceState({}, '', search ? `/settings/facebook?${search}` : '/settings/facebook')
}

function d(container: HTMLElement, id: string) {
  return container.querySelector<HTMLDetailsElement>(`details#${id}`)!
}

// Simulate the browser's exclusive-accordion outcome: exactly `openId` open (or
// none), then fire the native `toggle` event the handler listens for.
function applyToggle(container: HTMLElement, openId: string | null) {
  IDS.forEach((id) => (d(container, id).open = id === openId))
  d(container, openId ?? 'facebook').dispatchEvent(new Event('toggle'))
}

beforeEach(() => {
  replace.mockReset()
  setUrl('')
})
afterEach(cleanup)

describe('UrlSyncedAccordion — sentinel URL sync', () => {
  it('open a section → ?section=<id>', () => {
    const { container } = render(<Tree />)
    applyToggle(container, 'whatsapp')
    expect(replace).toHaveBeenCalledWith('/settings/facebook?section=whatsapp', { scroll: false })
  })

  it('close the open section → ?section=none (never deletes the param)', () => {
    setUrl('section=whatsapp')
    const { container } = render(<Tree />)
    applyToggle(container, null)
    expect(replace).toHaveBeenCalledWith('/settings/facebook?section=none', { scroll: false })
  })

  it('close the default Facebook (no param present) → ?section=none', () => {
    setUrl('') // fresh visit, Facebook open by default, no param
    const { container } = render(<Tree />)
    applyToggle(container, null)
    expect(replace).toHaveBeenCalledWith('/settings/facebook?section=none', { scroll: false })
  })

  it('close templates → ?section=none', () => {
    setUrl('section=templates')
    const { container } = render(<Tree />)
    applyToggle(container, null)
    expect(replace).toHaveBeenCalledWith('/settings/facebook?section=none', { scroll: false })
  })

  it('from all-closed, open Facebook → ?section=facebook', () => {
    setUrl('section=none')
    const { container } = render(<Tree />)
    applyToggle(container, 'facebook')
    expect(replace).toHaveBeenCalledWith('/settings/facebook?section=facebook', { scroll: false })
  })

  it('from all-closed, open WhatsApp → ?section=whatsapp', () => {
    setUrl('section=none')
    const { container } = render(<Tree />)
    applyToggle(container, 'whatsapp')
    expect(replace).toHaveBeenCalledWith('/settings/facebook?section=whatsapp', { scroll: false })
  })

  it('switch WhatsApp → Facebook → ?section=facebook (exclusive)', () => {
    setUrl('section=whatsapp')
    const { container } = render(<Tree />)
    applyToggle(container, 'facebook')
    expect(replace).toHaveBeenCalledWith('/settings/facebook?section=facebook', { scroll: false })
  })

  it('guard: no replace when the open section already matches the URL', () => {
    setUrl('section=whatsapp')
    const { container } = render(<Tree />)
    applyToggle(container, 'whatsapp')
    expect(replace).not.toHaveBeenCalled()
  })

  it('guard: no replace when already all-collapsed (?section=none)', () => {
    setUrl('section=none')
    const { container } = render(<Tree />)
    applyToggle(container, null)
    expect(replace).not.toHaveBeenCalled()
  })

  it('preserves other query params when writing the sentinel', () => {
    setUrl('foo=bar&section=whatsapp')
    const { container } = render(<Tree />)
    applyToggle(container, null)
    expect(replace).toHaveBeenCalledWith('/settings/facebook?foo=bar&section=none', { scroll: false })
  })
})
