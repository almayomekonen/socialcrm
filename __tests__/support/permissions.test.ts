import { test, expect } from 'vitest'
import { Roles } from '@/types/roles'
import {
  canViewSupportRequest,
  canReplyToSupportRequest,
  visibilityScopeFor,
} from '@/lib/support/permissions'

const agencyA = 101
const agencyB = 202

const author = { id: 5, role: Roles.AGNT, agencyId: agencyA }
const colleague = { id: 6, role: Roles.AGNT, agencyId: agencyA }
const admin = { id: 7, role: Roles.ADMIN, agencyId: agencyA }
const gm = { id: 8, role: Roles.GM, agencyId: agencyA }
const foreignAdmin = { id: 9, role: Roles.ADMIN, agencyId: agencyB }

const row = { agencyId: agencyA, createdByUserId: 5 }

test('the author can see their own request', () => {
  expect(canViewSupportRequest(author, row)).toBe(true)
})

test('a colleague in the same agency cannot see it', () => {
  expect(canViewSupportRequest(colleague, row)).toBe(false)
})

test('ADMIN and GM see every request in their own agency', () => {
  expect(canViewSupportRequest(admin, row)).toBe(true)
  expect(canViewSupportRequest(gm, row)).toBe(true)
})

test('NO role in another agency can see it — not even ADMIN', () => {
  for (const role of [Roles.ADMIN, Roles.GM, Roles.MNGR, Roles.AGNT, Roles.OFFICE, Roles.EXT]) {
    expect(canViewSupportRequest({ id: 9, role, agencyId: agencyB }, row)).toBe(false)
  }
  expect(canViewSupportRequest(foreignAdmin, row)).toBe(false)
})

test('an id collision across agencies does not grant access', () => {
  // Same user id, different tenant. The agency check runs first and alone
  // decides this — if it ever stopped doing so, this is the test that fails.
  expect(canViewSupportRequest({ id: 5, role: Roles.AGNT, agencyId: agencyB }, row)).toBe(false)
})

test('an orphaned request (deleted author) is visible to admins only', () => {
  const orphan = { agencyId: agencyA, createdByUserId: null }
  expect(canViewSupportRequest(admin, orphan)).toBe(true)
  expect(canViewSupportRequest(author, orphan)).toBe(false)
  expect(canViewSupportRequest(colleague, orphan)).toBe(false)
})

test('an orphaned request in another agency stays invisible', () => {
  const orphan = { agencyId: agencyB, createdByUserId: null }
  expect(canViewSupportRequest(admin, orphan)).toBe(false)
})

test('reply permission matches view permission in V1', () => {
  expect(canReplyToSupportRequest(author, row)).toBe(canViewSupportRequest(author, row))
  expect(canReplyToSupportRequest(colleague, row)).toBe(false)
})

test('missing viewer or row is refused rather than throwing', () => {
  expect(canViewSupportRequest(null as any, row)).toBe(false)
  expect(canViewSupportRequest(author, null as any)).toBe(false)
})

test('scope is agency-wide for admins and own-only for everyone else', () => {
  expect(visibilityScopeFor(admin)).toBe('agency')
  expect(visibilityScopeFor(gm)).toBe('agency')
  expect(visibilityScopeFor(author)).toBe('own')
  expect(visibilityScopeFor({ id: 1, role: Roles.MNGR, agencyId: agencyA })).toBe('own')
  expect(visibilityScopeFor({ id: 1, role: Roles.OFFICE, agencyId: agencyA })).toBe('own')
  expect(visibilityScopeFor({ id: 1, role: Roles.EXT, agencyId: agencyA })).toBe('own')
})
