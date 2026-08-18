// @vitest-environment jsdom
//
// Mobile Settings — the destinations reached from the "עוד" hub.
//
// MEASURED BEFORE WRITTEN. Walking the mobile navigation graph at 360 and 390
// found three Settings destinations rendering real desktop `<table>` elements
// inside `MobileWorkspaceShell`:
//
//   /settings/edit_users      2 tables, 12 sub-44px targets  → mobile list
//   /settings/update_security 1 table,  14 sub-44px targets  → mobile activity list
//   /settings/ai-inspector    2 tables                       → desktop handoff
//
// These tests pin those three decisions. The "no table" assertions are the
// point: they are what stops the desktop table being reintroduced by a later
// refactor of the shared settings pages.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/settings/edit_users',
}))

import UsersListMobile from '@/components/settings/mobile/UsersListMobile'
import LoginActivityMobile from '@/components/settings/mobile/LoginActivityMobile'
import { DESKTOP_ONLY_SECTIONS, DESKTOP_ONLY_ROUTES } from '@/lib/mobile/desktopOnlyRoutes'
import { MORE_ITEMS, visibleMoreItems } from '@/components/mobile/moreDestinations'

afterEach(cleanup)

const users = [
  { id: 1, name: 'דנה כהן', email: 'dana@example.com', phone: '0540000001', role: 'ADMIN', suspended: false },
  { id: 2, name: 'יוסי לוי', email: 'yossi@example.com', phone: null, role: 'AGNT', suspended: true },
]
const invitations = [
  { id: 9, name: 'רות מזרחי', email: 'ruth@example.com', role: 'AGNT', status: 'pending', expiresAt: '01/09/2026' },
]

describe('משתמשים — a mobile list, never the desktop users table', () => {
  test('renders NO table (the measured defect: 2 tables inside the mobile shell)', () => {
    const { container } = render(<UsersListMobile users={users} invitations={invitations} />)
    expect(container.querySelectorAll('table')).toHaveLength(0)
    expect(container.querySelectorAll('[role="grid"]')).toHaveLength(0)
  })

  test('a row leads with the name and carries role, with the email as secondary', () => {
    render(<UsersListMobile users={users} invitations={invitations} />)
    expect(screen.getByText('דנה כהן')).toBeTruthy()
    expect(screen.getByText('dana@example.com')).toBeTruthy()
    expect(screen.getAllByText('אדמין').length).toBeGreaterThan(0)
  })

  test('SUSPENDED is shown only when true — an "active" chip on every row is noise', () => {
    render(<UsersListMobile users={users} invitations={invitations} />)
    expect(screen.getAllByText('מושעה')).toHaveLength(1)
  })

  test('tapping a user opens a named sheet with their details', () => {
    render(<UsersListMobile users={users} invitations={invitations} />)
    fireEvent.click(screen.getByText('דנה כהן'))
    const dialog = screen.getByRole('dialog', { name: 'דנה כהן' })
    expect(dialog).toBeTruthy()
    // Contact details become real OS actions rather than inert text.
    expect(screen.getByRole('link', { name: /dana@example\.com/ }).getAttribute('href')).toBe('mailto:dana@example.com')
    expect(screen.getByRole('link', { name: /0540000001/ }).getAttribute('href')).toBe('tel:0540000001')
  })

  test('the sheet states plainly that editing is on desktop — no control that would refuse', () => {
    render(<UsersListMobile users={users} invitations={invitations} />)
    fireEvent.click(screen.getByText('דנה כהן'))
    expect(screen.getByText(/זמינים מהמחשב/)).toBeTruthy()
    // Read-only by construction: no destructive or mutating affordance.
    for (const name of [/מחק/, /השעה/, /שמור/, /הוסף משתמש/]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  test('empty states are explicit, not blank regions', () => {
    render(<UsersListMobile users={[]} invitations={[]} />)
    expect(screen.getByText(/אין עדיין משתמשים/)).toBeTruthy()
    expect(screen.getByText(/אין הזמנות ממתינות/)).toBeTruthy()
  })

  test('an invitation row is inert — it has nothing further to show', () => {
    render(<UsersListMobile users={users} invitations={invitations} />)
    expect(screen.getByText('רות מזרחי')).toBeTruthy()
    // Users are buttons (they open a sheet); invitations must not be.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(buttons.some((t) => t.includes('רות מזרחי'))).toBe(false)
  })
})

describe('פעילות התחברות — a mobile list, never IpsTable', () => {
  const rows = [
    { device: 'Chrome · macOS', ip: '81.2.3.4', at: '2026-08-17T09:00:00Z' },
    { device: 'Safari · iOS', ip: '81.2.3.5', at: '2026-08-16T09:00:00Z' },
  ]

  test('renders NO table (the measured defect: 1 table inside the mobile shell)', () => {
    const { container } = render(<LoginActivityMobile rows={rows} />)
    expect(container.querySelectorAll('table')).toHaveLength(0)
  })

  test('every login is still listed, device first', () => {
    render(<LoginActivityMobile rows={rows} />)
    expect(screen.getByText('Chrome · macOS')).toBeTruthy()
    expect(screen.getByText('Safari · iOS')).toBeTruthy()
    expect(screen.getByText('81.2.3.4')).toBeTruthy()
  })

  test('the IP reads left-to-right under an RTL heading', () => {
    render(<LoginActivityMobile rows={rows} />)
    expect(screen.getByText('81.2.3.4').getAttribute('dir')).toBe('ltr')
  })
})

describe('AI Inspector — handed off, and not advertised', () => {
  test('is registered as a desktop-only section', () => {
    expect(DESKTOP_ONLY_SECTIONS.ai_inspector).toBeTruthy()
    expect(DESKTOP_ONLY_ROUTES.ai_inspector).toEqual({ path: '/settings/ai-inspector', exact: false })
  })

  test('is NOT listed in the mobile "עוד" hub for anyone', () => {
    // A row whose only outcome is "open this on a computer" is the accidental
    // dead end the hub's own rule forbids. The route still answers a typed URL
    // with the handoff; it is simply not offered.
    expect(MORE_ITEMS.some((i) => i.href === '/settings/ai-inspector')).toBe(false)
    for (const role of ['ADMIN', 'MNGR', 'AGNT', 'OFFICE']) {
      const items = visibleMoreItems({ role, inspectorEnabled: true })
      expect(items.some((i) => i.href === '/settings/ai-inspector'), role).toBe(false)
    }
  })

  test('every remaining hub destination is a real screen, not a handoff', () => {
    const handoffPaths = new Set(Object.values(DESKTOP_ONLY_ROUTES).map((r) => r.path))
    for (const item of visibleMoreItems({ role: 'ADMIN', inspectorEnabled: true })) {
      expect(handoffPaths.has(item.href), `${item.title} → ${item.href}`).toBe(false)
    }
  })
})
