// @vitest-environment jsdom
//
// useFloatingMenu's LIGHT-DISMISS CONTRACT — the shared hook, not any one menu.
//
// Written against a minimal harness rather than NotificationPanel on purpose: the
// bug these tests pin was a defect in the hook, and every consumer inherits it.
// A test coupled to the notification panel would have proven the panel works
// while the next scrollable consumer walked into the same trap.
//
// The harness portals its menu to document.body, because that is the shape all
// current consumers use and because `contains()` across a portal boundary is
// exactly the part that has to keep working.
//
// It lives under __tests__/notifications because that is the green gate the
// scrollable consumer that exposed the bug already runs in
// (`npm run test:notifications`); the assertions are about lib/useFloatingMenu.
//
// WHY THE SCROLL EVENTS HERE ARE NON-BUBBLING: a scroll on an element does not
// bubble. The hook hears it only through a CAPTURE listener on window, which is
// what makes the capture flag load-bearing rather than incidental — the app's
// pages scroll inner containers, never the window. Anyone who "simplifies" the
// listener by dropping capture fails the outside-scroll test below.

import { describe, expect, it, afterEach } from 'vitest'
import React from 'react'
import { createPortal } from 'react-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useFloatingMenu } from '@/lib/useFloatingMenu'

afterEach(cleanup)

function Harness() {
  const menu = useFloatingMenu()
  return (
    <div>
      <div ref={menu.wrapRef}>
        <button type='button' onClick={menu.toggle}>
          trigger
        </button>
        {/* A scrollable region inside the TRIGGER's wrapper. Contrived, but the
            hook's guard covers wrapRef as well as menuRef, so both are pinned. */}
        <div data-testid='wrapScroller'>wrapper content</div>
      </div>

      {/* Outside both refs — a stand-in for the app's real scroll container
          (div.tbl on /leads), which is an inner element, never the window. */}
      <div data-testid='pageScroller'>page content</div>

      {menu.open && menu.pos
        ? createPortal(
            <div ref={menu.menuRef} data-testid='menu'>
              <button type='button'>menu item</button>
              <ul data-testid='menuList'>
                <li>row</li>
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
const isOpen = () => screen.queryByTestId('menu') !== null

describe('useFloatingMenu — scroll', () => {
  it('keeps the menu open when the scroll originates inside the menu', () => {
    render(<Harness />)
    open()
    expect(isOpen()).toBe(true)

    fireEvent.scroll(screen.getByTestId('menuList'))

    expect(isOpen()).toBe(true)
  })

  it('keeps the menu open when the scroll originates inside the trigger wrapper', () => {
    render(<Harness />)
    open()

    fireEvent.scroll(screen.getByTestId('wrapScroller'))

    expect(isOpen()).toBe(true)
  })

  it('closes the menu when the scroll originates outside both refs', () => {
    render(<Harness />)
    open()
    expect(isOpen()).toBe(true)

    fireEvent.scroll(screen.getByTestId('pageScroller'))

    expect(isOpen()).toBe(false)
  })

  it('closes the menu when the document itself scrolls', () => {
    render(<Harness />)
    open()

    fireEvent.scroll(document)

    expect(isOpen()).toBe(false)
  })

  it('does not confuse a scroll inside the menu with one outside it', () => {
    render(<Harness />)
    open()

    // Scrolling the list repeatedly must never close it — the real gesture is a
    // stream of scroll events, not one.
    fireEvent.scroll(screen.getByTestId('menuList'))
    fireEvent.scroll(screen.getByTestId('menuList'))
    fireEvent.scroll(screen.getByTestId('menuList'))
    expect(isOpen()).toBe(true)

    // And the outside path must still work afterwards.
    fireEvent.scroll(screen.getByTestId('pageScroller'))
    expect(isOpen()).toBe(false)
  })
})

/**
 * The rest of the light-dismiss contract, pinned here so the scroll fix cannot
 * quietly change what was already correct.
 */
describe('useFloatingMenu — the other dismiss paths are unchanged', () => {
  it('stays open when the pointer goes down inside the menu', () => {
    render(<Harness />)
    open()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'menu item' }))

    expect(isOpen()).toBe(true)
  })

  it('stays open when the pointer goes down inside the trigger wrapper', () => {
    render(<Harness />)
    open()

    fireEvent.mouseDown(screen.getByTestId('wrapScroller'))

    expect(isOpen()).toBe(true)
  })

  it('closes when the pointer goes down outside both refs', () => {
    render(<Harness />)
    open()

    fireEvent.mouseDown(screen.getByTestId('pageScroller'))

    expect(isOpen()).toBe(false)
  })

  it('closes on Escape', () => {
    render(<Harness />)
    open()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(isOpen()).toBe(false)
  })

  it('closes on resize', () => {
    render(<Harness />)
    open()

    fireEvent.resize(window)

    expect(isOpen()).toBe(false)
  })
})
