// @vitest-environment jsdom
//
// REGRESSION — the mobile workspace must be sized to the VISIBLE viewport, not
// the layout viewport.
//
// THE DEFECT (reported from production, real iPhone). Tapping the WhatsApp
// composer in שיחות pushed the whole screen up: the thread header went off the
// top, the tab bar was stranded with blank below it, and the layout stayed wrong
// after the keyboard was dismissed.
//
// WHY THE EARLIER ROUNDS DID NOT COVER IT. fa802aa5 / 89da1623 / c12a7ea7 /
// c65b80cf fixed the DOCUMENT-scroll half — `body`'s computed `overflow-y: auto`
// second scroller, the nested 100dvh, and pointer capture eating the pan
// gesture. None of them touched the UNIT. The workspace column was still
// `100dvh`, and `dvh` is a LAYOUT-viewport unit that iOS Safari does not shrink
// for the software keyboard: it shrinks the VISUAL viewport and pans the layout
// viewport up to reveal the focused field. Locking the document does not prevent
// that pan — it is not document scroll.
//
// THE CONTRACT LOCKED HERE. The shell publishes the real visible height on
// <html> from `window.visualViewport`, and the workspace column is sized from it
// with a `100dvh` fallback. Sized to the visible area, the composer is already
// above the keyboard, so there is nothing left for Safari to pan.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, afterEach, beforeEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {} }),
  usePathname: () => '/inbox',
}))

import MobileWorkspaceShell from '@/components/mobile/MobileWorkspaceShell'

const VAR = '--mobile-visible-h'

/**
 * jsdom ships no `visualViewport`. This stub is the minimum the hook consumes —
 * height, scale, offsetTop and the two events iOS actually fires — so the test
 * exercises the real listener wiring rather than a mocked hook.
 */
function installVisualViewport(initial: { height?: number; scale?: number; offsetTop?: number } = {}) {
  const target = new EventTarget()
  const vv = {
    height: 852,
    scale: 1,
    offsetTop: 0,
    ...initial,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    emit: (type: 'resize' | 'scroll') => act(() => void target.dispatchEvent(new Event(type))),
  }
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true })
  return vv
}

function removeVisualViewport() {
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true })
}

const published = () => document.documentElement.style.getPropertyValue(VAR)
const shell = () => (
  <MobileWorkspaceShell>
    <p>תוכן</p>
  </MobileWorkspaceShell>
)

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
  document.documentElement.style.removeProperty(VAR)
})

afterEach(() => {
  cleanup()
  removeVisualViewport()
  document.documentElement.style.removeProperty(VAR)
  vi.restoreAllMocks()
})

describe('mobile workspace — visible-viewport sizing (iOS keyboard regression)', () => {
  test('1. the workspace column is sized from the visible-viewport utility, not h-dvh', () => {
    const src = readFileSync(join(process.cwd(), 'app/(app)/layout.tsx'), 'utf8')
    expect(src).toContain("className='flex flex-col h-visible-viewport min-h-0 items-stretch'")
    // `h-dvh` on this column is the defect: a layout-viewport unit cannot
    // survive the software keyboard.
    expect(src).not.toContain("className='flex flex-col h-dvh min-h-0 items-stretch'")
  })

  test('2. the utility resolves to the published height and falls back to 100dvh', () => {
    const css = readFileSync(join(process.cwd(), 'lib/css/main.css'), 'utf8')
    expect(css).toMatch(/@utility h-visible-viewport\s*\{[^}]*height:\s*var\(--mobile-visible-h,\s*100dvh\)/)
  })

  test('3. the shell stays a flex child and never reintroduces its own viewport height', () => {
    installVisualViewport()
    const { container } = render(shell())

    // The nested-100dvh defect fixed earlier (fa802aa5) must not come back in
    // any unit: exactly ONE element owns the viewport height, and it is the
    // column in the app layout, not this shell.
    const el = container.querySelector('[data-mobile-workspace]') as HTMLElement
    expect(el).not.toBeNull()
    const classes = el.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['flex-1', 'min-h-0']))
    expect(classes).not.toContain('h-dvh')
    expect(classes).not.toContain('h-screen')
    expect(classes).not.toContain('h-visible-viewport')

    // ...and the shell is what mounts the publisher.
    const src = readFileSync(join(process.cwd(), 'components/mobile/MobileWorkspaceShell.tsx'), 'utf8')
    expect(src).toContain('useVisibleViewportHeight()')
  })

  test('4. mounting publishes the current visible height on <html>', () => {
    installVisualViewport({ height: 852 })
    render(shell())
    expect(published()).toBe('852px')
  })

  test('5. the keyboard opening shrinks the published height, and closing restores it', () => {
    const vv = installVisualViewport({ height: 852 })
    render(shell())
    expect(published()).toBe('852px')

    // iOS: the keyboard shrinks the VISUAL viewport only.
    vv.height = 515
    vv.emit('resize')
    expect(published()).toBe('515px')

    // Dismissing it restores the full height — the defect was that it did not.
    vv.height = 852
    vv.emit('resize')
    expect(published()).toBe('852px')
  })

  test('6. a panned layout viewport is undone, so the thread header cannot be stranded', () => {
    const vv = installVisualViewport({ height: 852 })
    render(shell())

    vv.height = 515
    vv.offsetTop = 337 // Safari panned the page up to reveal the composer.
    vv.emit('scroll')

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  test('7. pinch-zoom is the user’s own pan and is left alone', () => {
    const vv = installVisualViewport({ height: 852 })
    render(shell())
    ;(window.scrollTo as unknown as ReturnType<typeof vi.fn>).mockClear()

    vv.scale = 2
    vv.height = 426 // zoomed in: half the CSS pixels are visible
    vv.offsetTop = 200
    vv.emit('scroll')
    expect(window.scrollTo).not.toHaveBeenCalled()

    // ...and the published height stays the LAYOUT height, so zooming in does
    // not shrink the workspace to the magnified rectangle.
    vv.emit('resize')
    expect(published()).toBe('852px')
  })

  test('8. no visualViewport support publishes nothing — CSS keeps the 100dvh fallback', () => {
    removeVisualViewport()
    render(shell())
    expect(published()).toBe('')
  })

  test('9. unmounting removes the property, so no other surface inherits it', () => {
    installVisualViewport({ height: 852 })
    const view = render(shell())
    expect(published()).toBe('852px')
    view.unmount()
    expect(published()).toBe('')
  })
})
