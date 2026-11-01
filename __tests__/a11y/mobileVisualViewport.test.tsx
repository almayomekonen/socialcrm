// @vitest-environment jsdom
//
// REGRESSION — the mobile workspace column is pinned to the VISIBLE viewport.
//
// WHAT THESE TESTS ARE AND ARE NOT. jsdom is not WebKit; nothing here proves iOS
// behaviour, and a previous fix for this same bug shipped green because its test
// asserted that `window.scrollTo` had been CALLED — true in jsdom, inert in the
// browser, worse in production. The proof for this change is a measurement on a
// real iOS 26.3 simulator against this app's own compiled CSS:
//
//   before   keyboard up:  dvh=714  vvH=377  off=337  colT=-337   ← broken
//   after    keyboard up:  dvh=714  vvH=614  off=100  colT=0  colH=614
//   after    dismissed:    dvh=714  vvH=714  off=0    colT=0  colH=714
//
// These tests lock the CONTRACT that measurement validated — which values are
// published, from what, and what the column does with them — so it cannot be
// edited away silently. They are a tripwire, not the evidence.
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

const H = '--mobile-visible-h'
const TOP = '--mobile-visible-top'

function installVisualViewport(init: { height?: number; scale?: number; offsetTop?: number } = {}) {
  const target = new EventTarget()
  const vv = {
    height: 714,
    scale: 1,
    offsetTop: 0,
    ...init,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    emit: (t: 'resize' | 'scroll') => act(() => void target.dispatchEvent(new Event(t))),
  }
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true })
  return vv
}
const removeVV = () =>
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true })

const read = (p: string) => document.documentElement.style.getPropertyValue(p)
const shell = () => (
  <MobileWorkspaceShell>
    <p>תוכן</p>
  </MobileWorkspaceShell>
)

beforeEach(() => {
  document.documentElement.style.removeProperty(H)
  document.documentElement.style.removeProperty(TOP)
})
afterEach(() => {
  cleanup()
  removeVV()
  document.documentElement.style.removeProperty(H)
  document.documentElement.style.removeProperty(TOP)
})

describe('mobile workspace — pinned to the visible viewport (iOS keyboard)', () => {
  test('1. the column uses the utility, not a viewport-unit height', () => {
    const src = readFileSync(join(process.cwd(), 'app/(he)/(app)/layout.tsx'), 'utf8')
    expect(src).toContain("className='mobile-viewport-column flex flex-col min-h-0 items-stretch'")
    expect(src).not.toContain("className='flex flex-col h-dvh min-h-0 items-stretch'")
  })

  test('2. the utility pins height AND top, and must never use transform', () => {
    const css = readFileSync(join(process.cwd(), 'lib/css/main.css'), 'utf8')
    const block = css.match(/@utility mobile-viewport-column\s*\{[^}]*\}/)?.[0] ?? ''
    expect(block).toMatch(/position:\s*fixed/)
    expect(block).toMatch(/top:\s*var\(--mobile-visible-top,\s*0px\)/)
    expect(block).toMatch(/height:\s*var\(--mobile-visible-h,\s*100dvh\)/)
    // A transform would make this column a containing block for every descendant
    // position:fixed element (modals, toasts, sheets). `fixed` does not.
    expect(block).not.toMatch(/transform/)
  })

  test('3. the shell is what mounts the publisher', () => {
    const src = readFileSync(join(process.cwd(), 'components/mobile/MobileWorkspaceShell.tsx'), 'utf8')
    expect(src).toContain('useVisibleViewportHeight()')
  })

  test('4. mounting publishes both the visible height and the top offset', () => {
    installVisualViewport({ height: 714, offsetTop: 0 })
    render(shell())
    expect(read(H)).toBe('714px')
    expect(read(TOP)).toBe('0px')
  })

  test('5. the keyboard opening publishes the shrunken height AND the pan offset', () => {
    const vv = installVisualViewport({ height: 714 })
    render(shell())

    // Measured on device: the keyboard shrinks the visual viewport and Safari
    // pans the layout viewport by the same amount to reach the composer.
    vv.height = 614
    vv.offsetTop = 100
    vv.emit('resize')
    expect(read(H)).toBe('614px')
    expect(read(TOP)).toBe('100px')

    // Dismissing restores both.
    vv.height = 714
    vv.offsetTop = 0
    vv.emit('resize')
    expect(read(H)).toBe('714px')
    expect(read(TOP)).toBe('0px')
  })

  test('6. a pan reported via scroll alone is followed too', () => {
    const vv = installVisualViewport({ height: 614, offsetTop: 0 })
    render(shell())
    vv.offsetTop = 100
    vv.emit('scroll')
    expect(read(TOP)).toBe('100px')
  })

  test('7. pinch-zoom magnifies rather than shrinks, and its pan is left alone', () => {
    const vv = installVisualViewport({ height: 714 })
    render(shell())

    vv.scale = 2
    vv.height = 357 // zoomed 2×: half the CSS pixels are visible
    vv.offsetTop = 200 // the user's own panning
    vv.emit('resize')

    // height * scale returns the layout height, so the column is not shrunk to
    // the loupe...
    expect(read(H)).toBe('714px')
    // ...and following the user's pan would fight them.
    expect(read(TOP)).toBe('0px')
  })

  test('8. no visualViewport publishes nothing — CSS fallbacks own the geometry', () => {
    removeVV()
    render(shell())
    expect(read(H)).toBe('')
    expect(read(TOP)).toBe('')
  })

  test('9. unmounting removes both, so no other surface inherits them', () => {
    installVisualViewport({ height: 714 })
    const view = render(shell())
    expect(read(H)).toBe('714px')
    view.unmount()
    expect(read(H)).toBe('')
    expect(read(TOP)).toBe('')
  })
})
