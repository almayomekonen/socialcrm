// @vitest-environment jsdom
//
// The NAV CONVERSATION BADGE must behave exactly as it did before notifications
// existed. P2.3 introduced a second badge (the bell) and, to avoid two drifting
// implementations of the 99+ cap, moved `NavBadge` out of Nav.tsx into its own
// module. This file is the proof that the move changed nothing:
//
//   - the badge still renders the same markup and the same cap
//   - the conversation count still comes from awareness, not from the feed
//   - OFFICE still has no inbox link and therefore no conversation badge
//
// Runs without a database: `npm run test:notifications`.

import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import Nav from '@/lib/navs/Nav'
import NavBadge from '@/lib/navs/NavBadge'
import { Roles } from '@/types/roles'

vi.mock('next/navigation', () => ({ usePathname: () => '/leads', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/actions/auth', () => ({ logout: vi.fn() }))

afterEach(cleanup)

const user = (role: Roles) => ({ id: 1, role, email: 'a@b.com', picture: null, name: 'דנה' })

/** The badge sits on the inbox link; find it by that link's accessible name. */
function inboxBadges() {
  return screen
    .getAllByRole('link')
    .filter((a) => a.getAttribute('href') === '/inbox')
    .flatMap((a) => Array.from(a.querySelectorAll('span[aria-hidden]')))
}

describe('NavBadge itself', () => {
  it('renders an exact count up to 99', () => {
    const { container } = render(<NavBadge count={99} />)
    expect(container.textContent).toBe('99')
  })

  it('caps at 99+', () => {
    const { container } = render(<NavBadge count={100} />)
    expect(container.textContent).toBe('99+')
  })

  it('stays hidden from assistive tech — the control it sits on carries the name', () => {
    const { container } = render(<NavBadge count={3} />)
    expect(container.firstElementChild?.getAttribute('aria-hidden')).not.toBeNull()
  })

  it('keeps the markup Nav rendered before the extraction', () => {
    const { container } = render(<NavBadge count={5} />)
    const span = container.firstElementChild!
    expect(span.tagName).toBe('SPAN')
    expect(span.className).toBe(
      'absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white',
    )
  })
})

describe('the conversation badge in the nav', () => {
  it('shows the server-rendered unread conversation count', () => {
    render(<Nav user={user(Roles.AGNT)} inboxUnread={7} />)
    expect(inboxBadges().some((b) => b.textContent === '7')).toBe(true)
  })

  it('caps at 99+ exactly as before', () => {
    render(<Nav user={user(Roles.AGNT)} inboxUnread={250} />)
    expect(inboxBadges().some((b) => b.textContent === '99+')).toBe(true)
  })

  it('renders no badge at zero', () => {
    render(<Nav user={user(Roles.AGNT)} inboxUnread={0} />)
    expect(inboxBadges()).toHaveLength(0)
  })

  it('is unaffected by notification state — nothing here reads the feed', () => {
    // Rendered with no NotificationProvider at all: the conversation badge does not
    // depend on one, and must not start to.
    render(<Nav user={user(Roles.AGNT)} inboxUnread={4} />)
    expect(inboxBadges().some((b) => b.textContent === '4')).toBe(true)
  })
})

describe('the OFFICE role', () => {
  it('still has no inbox link, and therefore no conversation badge', () => {
    render(<Nav user={user(Roles.OFFICE)} inboxUnread={9} />)

    const inboxLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/inbox')
    expect(inboxLinks).toHaveLength(0)
    expect(inboxBadges()).toHaveLength(0)
  })

  it('does not gain a conversation badge from a non-zero server count', () => {
    render(<Nav user={user(Roles.OFFICE)} inboxUnread={120} />)
    expect(screen.queryByText('99+')).toBeNull()
    expect(screen.queryByText('120')).toBeNull()
  })
})
