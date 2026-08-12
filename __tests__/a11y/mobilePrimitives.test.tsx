// @vitest-environment jsdom
//
// Accessibility regression suite for the mobile shell primitives (Phase 1).
//
// These four components are the substrate every later mobile screen is built
// from, so an accessibility defect here is inherited by Today, Leads, Lead
// Details and Follow-ups at once. Assertions query the COMPUTED accessibility
// tree (getByRole uses dom-accessibility-api, the same accessible-name algorithm
// a screen reader applies), so a regression here is a real regression for
// assistive tech — not a snapshot diff.
//
// Guarantees locked in (do not weaken without an accessibility review):
//   1. BottomSheet is a named dialog and reuses ModalPop's focus trap / Escape.
//   2. BottomSheet locks body scroll while open and RESTORES the prior value.
//   3. MobileTabBar is a nav landmark; the active tab is aria-current='page'.
//   4. A badged tab states its count in its accessible NAME (the badge itself is
//      aria-hidden, so the number would otherwise never reach a screen reader).
//   5. MobileHeader exposes exactly one h1, and back is a named button.
//   6. A top-level tab screen renders no back control.
//   7. MobileListRow is a single link/button whose name is the row title —
//      never a nested-interactive tap target.
//   8. Touch targets meet the ~44px minimum via the documented size classes.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const push = vi.fn()
const back = vi.fn()
let pathname = '/dashboard'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
  usePathname: () => pathname,
}))

import BottomSheet from '@/components/mobile/BottomSheet'
import MobileTabBar, { isTabActive, mobileTabsWithBadges } from '@/components/mobile/MobileTabBar'
import MobileHeader from '@/components/mobile/MobileHeader'
import MobileListRow, { MobileList } from '@/components/mobile/MobileListRow'
import MobileStickyActions from '@/components/mobile/MobileStickyActions'

afterEach(() => {
  cleanup()
  pathname = '/dashboard'
  document.body.style.overflow = ''
  vi.clearAllMocks()
})

describe('BottomSheet', () => {
  test('1. is a dialog whose accessible name is its visible title', () => {
    render(
      <BottomSheet open onClose={() => {}} title='סינון לידים'>
        <button>החל</button>
      </BottomSheet>,
    )
    expect(screen.getByRole('dialog', { name: 'סינון לידים' })).toBeTruthy()
  })

  test('1b. Escape closes (inherited from ModalPop, not reimplemented)', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title='סינון לידים'>
        <button>החל</button>
      </BottomSheet>,
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  test('1c. the close control has an accessible name', () => {
    render(
      <BottomSheet open onClose={() => {}} title='סינון לידים'>
        <button>החל</button>
      </BottomSheet>,
    )
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeTruthy()
  })

  test('2. locks body scroll while open and restores the PREVIOUS value on close', () => {
    // A pre-existing lock (e.g. an outer sheet) must survive this sheet closing.
    document.body.style.overflow = 'scroll'
    const { unmount } = render(
      <BottomSheet open onClose={() => {}} title='סינון'>
        <button>החל</button>
      </BottomSheet>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  test('2b. a top/middle dialog does NOT lock body scroll (desktop unchanged)', async () => {
    const ModalPop = (await import('@/lib/modals/ModalPop')).default
    document.body.style.overflow = ''
    render(
      <ModalPop open pos='middle' label='טופס' onClose={() => {}}>
        <button>שמור</button>
      </ModalPop>,
    )
    expect(document.body.style.overflow).toBe('')
  })
})

describe('MobileTabBar', () => {
  test('3. is a navigation landmark with an accessible name', () => {
    render(<MobileTabBar />)
    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeTruthy()
  })

  test('3b. the active tab is marked aria-current="page", and only it', () => {
    pathname = '/leads'
    render(<MobileTabBar />)
    const current = screen.getAllByRole('link').filter((el) => el.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('לידים')
  })

  test('3c. active matching uses the first path segment (matches desktop Nav)', () => {
    expect(isTabActive('/leads', '/leads')).toBe(true)
    expect(isTabActive('/leads?status=new', '/leads')).toBe(true)
    expect(isTabActive('/settings/self_edit', '/settings/self_edit')).toBe(true)
    expect(isTabActive('/dashboard', '/leads')).toBe(false)
  })

  test('4. a badged tab carries its count in the accessible name', () => {
    render(<MobileTabBar notificationCount={3} />)
    expect(screen.getByRole('link', { name: 'התראות, 3 חדשות' })).toBeTruthy()
  })

  test('4b. with no unread, the tab keeps its plain name (no "0 חדשות")', () => {
    render(<MobileTabBar notificationCount={0} />)
    expect(screen.getByRole('link', { name: 'התראות' })).toBeTruthy()
  })

  test('4c. the badge helper only ever badges the notifications tab', () => {
    const tabs = mobileTabsWithBadges(7)
    expect(tabs.filter((t) => t.badge != null)).toHaveLength(1)
    expect(tabs.find((t) => t.badge === 7)?.href).toBe('/notifications')
  })

  test('every tab has a visible text label, never icon-only', () => {
    render(<MobileTabBar />)
    for (const link of screen.getAllByRole('link')) {
      expect(link.textContent?.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('MobileHeader', () => {
  test('5. renders exactly one h1 carrying the title', () => {
    render(<MobileHeader title='דני לוי' onBack />)
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe('דני לוי')
  })

  test('5b. back is a real button with an accessible name and calls router.back()', () => {
    render(<MobileHeader title='דני לוי' onBack />)
    const btn = screen.getByRole('button', { name: 'חזרה' })
    fireEvent.click(btn)
    expect(back).toHaveBeenCalled()
  })

  test('5c. an explicit onBack handler is used instead of history', () => {
    const custom = vi.fn()
    render(<MobileHeader title='דני לוי' onBack={custom} />)
    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }))
    expect(custom).toHaveBeenCalled()
    expect(back).not.toHaveBeenCalled()
  })

  test('6. a top-level tab screen renders no back control', () => {
    render(<MobileHeader title='היום' />)
    expect(screen.queryByRole('button', { name: 'חזרה' })).toBeNull()
  })
})

describe('MobileListRow', () => {
  test('7. a navigating row is ONE link named by its title', () => {
    render(
      <MobileList>
        <MobileListRow href={'/clients/1/summary' as never} title='דני לוי' subtitle='054-000-0000' />
      </MobileList>,
    )
    const link = screen.getByRole('link', { name: /דני לוי/ })
    expect(link.getAttribute('href')).toBe('/clients/1/summary')
    // No nested interactive element — a button inside a link is an invalid,
    // untappable target on touch.
    expect(link.querySelector('button')).toBeNull()
  })

  test('7b. a non-navigating row is a real button, not a click-handled div', () => {
    const onClick = vi.fn()
    render(<MobileListRow onClick={onClick} title='דני לוי' />)
    fireEvent.click(screen.getByRole('button', { name: /דני לוי/ }))
    expect(onClick).toHaveBeenCalled()
  })

  test('8. row and tab touch targets use the documented >=44px classes', () => {
    const { container } = render(<MobileListRow onClick={() => {}} title='דני לוי' />)
    // min-h-16 = 64px, comfortably past the 44px minimum.
    expect(container.querySelector('button')?.className).toContain('min-h-16')
  })

  test('8b. the tab bar reserves >=44px per target', () => {
    const { container } = render(<MobileTabBar />)
    // min-h-14 = 56px.
    expect(container.querySelector('a')?.className).toContain('min-h-14')
  })
})

describe('MobileStickyActions', () => {
  test('pays the safe-area inset when it is the bottom-most surface', () => {
    const { container } = render(
      <MobileStickyActions>
        <button>שמור שינויים</button>
      </MobileStickyActions>,
    )
    expect(container.firstElementChild?.className).toContain('env(safe-area-inset-bottom')
  })

  test('does NOT double-pay the inset when the tab bar is also present', () => {
    const { container } = render(
      <MobileStickyActions aboveTabBar>
        <button>שמור שינויים</button>
      </MobileStickyActions>,
    )
    expect(container.firstElementChild?.className).not.toContain('env(safe-area-inset-bottom')
  })

  test('sits below the header and tab bar in the stacking order', () => {
    const { container } = render(
      <MobileStickyActions>
        <button>שמור</button>
      </MobileStickyActions>,
    )
    // z-30 < MobileHeader z-40 < MobileTabBar z-50 < ModalPop portal z-99999.
    expect(container.firstElementChild?.className).toContain('z-30')
  })
})
