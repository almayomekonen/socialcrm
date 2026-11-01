// @vitest-environment jsdom
/**
 * The /agent nav entry: shown only when the layout's single availability
 * decision is true, and never to OFFICE — the role policy this change keeps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import Nav from '@/lib/navs/Nav'
import { Roles } from '@/types/roles'

vi.mock('next/navigation', () => ({ usePathname: () => '/leads', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/actions/auth', () => ({ logout: vi.fn() }))

afterEach(cleanup)

const user = (role: Roles) => ({ id: 1, role, email: 'a@b.com', picture: null, name: 'דנה' })
const agentLinks = () => screen.queryAllByRole('link').filter((a) => a.getAttribute('href') === '/agent')

describe('the /agent nav entry', () => {
  it.each([Roles.ADMIN, Roles.AGNT, Roles.MNGR])('%s sees it when the Agent is available', (role) => {
    render(<Nav user={user(role)} agentEnabled />)
    expect(agentLinks().length).toBeGreaterThan(0)
  })

  it('OFFICE never sees it, even when the Agent is available for the agency', () => {
    render(<Nav user={user(Roles.OFFICE)} agentEnabled />)
    expect(agentLinks()).toHaveLength(0)
  })

  it('nobody sees it when the Agent is not available', () => {
    render(<Nav user={user(Roles.ADMIN)} agentEnabled={false} />)
    expect(agentLinks()).toHaveLength(0)
  })
})
