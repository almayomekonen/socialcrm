import { test, expect } from 'vitest'
import { nextStatusAfterReply, resolvedAtFor } from '@/lib/support/status'

test('a support reply always parks the request on the customer', () => {
  for (const s of ['open', 'in_progress', 'waiting_for_customer', 'resolved'] as const) {
    expect(nextStatusAfterReply(s, 'support')).toBe('waiting_for_customer')
  }
})

test('a customer reply to a resolved request reopens it', () => {
  expect(nextStatusAfterReply('resolved', 'customer')).toBe('open')
})

test('a customer reply while waiting moves it into handling', () => {
  expect(nextStatusAfterReply('waiting_for_customer', 'customer')).toBe('in_progress')
})

test('a customer reply does NOT knock in_progress back to open', () => {
  // The load-bearing row: adding detail to a request someone is actively
  // working on must not erase the fact that they are working on it.
  expect(nextStatusAfterReply('in_progress', 'customer')).toBe('in_progress')
})

test('a customer reply on an open request leaves it open', () => {
  expect(nextStatusAfterReply('open', 'customer')).toBe('open')
})

test('a system message never changes status', () => {
  for (const s of ['open', 'in_progress', 'waiting_for_customer', 'resolved'] as const) {
    expect(nextStatusAfterReply(s, 'system')).toBe(s)
  }
})

test('entering resolved stamps resolvedAt', () => {
  const now = new Date('2026-08-10T09:00:00Z')
  expect(resolvedAtFor('resolved', null, now)).toEqual(now)
})

test('staying resolved does not re-stamp resolvedAt', () => {
  const original = new Date('2026-08-01T09:00:00Z')
  const now = new Date('2026-08-10T09:00:00Z')
  expect(resolvedAtFor('resolved', original, now)).toEqual(original)
})

test('leaving resolved clears resolvedAt', () => {
  const original = new Date('2026-08-01T09:00:00Z')
  const now = new Date('2026-08-10T09:00:00Z')
  expect(resolvedAtFor('open', original, now)).toBeNull()
  expect(resolvedAtFor('in_progress', original, now)).toBeNull()
  expect(resolvedAtFor('waiting_for_customer', original, now)).toBeNull()
})
