// @vitest-environment jsdom
//
// Landmark regression checks for RC-3: the app top bar is a `banner`, and the
// marketing primary navigation exposes a unique accessible name (so it is
// distinguishable from the breadcrumb <nav> on the same page).
//
// Nav.tsx (the sidebar) pulls server actions and is left to static verification
// + manual QA; its two <nav aria-label='ניווט ראשי'> are asserted by grep in the
// review, not here, to keep this suite free of brittle server-only mocks.

import { afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/leads' }))
vi.mock('@/components/copilot/CopilotTopbarTrigger', () => ({ default: () => null }))
// MarketingNavbar imports server actions from '@/actions/auth', which transitively
// load config/db and require DATABASE_URL under the no-DB test harness. Stub the
// module so importing/rendering the component here doesn't touch the database.
// Test-harness only — no production/accessibility code is affected.
vi.mock('@/actions/auth', () => ({
  logout: vi.fn(),
  getSessionState: vi.fn(() => Promise.resolve(false)),
}))

import Topbar from '@/lib/navs/Topbar'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'

afterEach(cleanup)

test('Topbar renders a banner landmark', () => {
  render(<Topbar user={{ name: 'דנה' } as any} />)
  expect(screen.getByRole('banner')).toBeTruthy()
})

test('marketing primary navigation has an accessible name', () => {
  render(<MarketingNavbar />)
  expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeTruthy()
})
