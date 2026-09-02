// @vitest-environment jsdom
//
// The "team member" trap.
//
// Two ADMINs in two days added a person through this surface expecting to give
// them access to SocialCRM, and got a name-only record that cannot log in.
// Across all of production that path was used twice and the real invitation
// zero times — a discoverability failure, not a model defect.
//
// EXT stays exactly what it is: an assignment label for לידים. These tests pin
// that the MODEL is untouched and that the SURFACE no longer promises access.
//
//   NODE_ENV=test VITEST_NO_DB=1 npx vitest run __tests__/settings

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/agntsAndGrps/AddAuthUsers', () => ({ default: () => <div /> }))
vi.mock('@/components/filter/EditSavedFilters', () => ({ default: () => <div /> }))
vi.mock('@/components/settings/userDetails/UserDetailsForm', () => ({ default: () => <div /> }))
vi.mock('@/components/settings/UploadClientData', () => ({ default: () => <div /> }))
vi.mock('../extUsers', () => ({ default: () => <div data-testid='ext-users' /> }))
vi.mock('@/components/extUsers', () => ({ default: () => <div data-testid='ext-users' /> }))

import SelfEdit from '@/components/settings/SelfEdit'

const base = { curUser: {}, users: [], extUsers: [], allUsers: [], gavePerm: [] }
const renderAs = (role: string) =>
  render(<SelfEdit {...base} user={{ id: 1, role }} />)

beforeEach(() => cleanup())

describe('the surface no longer promises system access', () => {
  it('is titled for lead assignment, not for "team members"', () => {
    renderAs('ADMIN')
    expect(screen.getByText('נציגים לשיוך לידים')).toBeTruthy()
    expect(screen.queryByText('אנשי צוות')).toBeNull()
  })

  it('states plainly that a נציג gets no login', () => {
    renderAs('ADMIN')
    const copy = screen.getByText(/נציגים הם שמות לשיוך לידים בלבד/)
    expect(copy.textContent).toMatch(/לא מקבלים גישה למערכת/)
    expect(copy.textContent).toMatch(/לא יכולים להתחבר/)
  })

  it('still renders the EXT management control — the feature is not removed', () => {
    renderAs('ADMIN')
    expect(screen.getByTestId('ext-users')).toBeTruthy()
  })
})

describe('the real invitation is discoverable — and only where it works', () => {
  it('an ADMIN gets a direct link to the invitation page', () => {
    renderAs('ADMIN')
    const link = screen.getByRole('link', { name: 'לשליחת הזמנה למשתמש במערכת' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/settings/edit_users')
  })

  it('a non-admin is NOT given an action that would hit a permission wall', () => {
    // /settings/(admin_settings)/layout.tsx rejects every role but ADMIN.
    for (const role of ['GM', 'AGENT', 'EXT']) {
      cleanup()
      renderAs(role)
      expect(screen.queryByRole('link', { name: 'לשליחת הזמנה למשתמש במערכת' })).toBeNull()
    }
  })

  it('a non-admin is still told how access is granted', () => {
    renderAs('AGENT')
    expect(screen.getByText(/יש לבקש ממנהל החשבון לשלוח לו הזמנה/)).toBeTruthy()
  })
})
